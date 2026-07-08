/**
 * ELIGIBILITY ORCHESTRATOR (270/271, real-time path)
 * flow: authz(channel) → ledger.open → route → network.checkEligibility
 *       → ledger.complete → outcome
 * The service never touches Stedi types — canonical in, canonical out.
 */
import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EligibilityInquiry, EligibilityOutcome } from '../../canonical/eligibility';
import { requireTenant } from '../../tenancy/tenant-context';
import { RoutingService } from '../routing/routing.service';
import { LedgerService } from '../transactions/ledger.service';
import { txLogger } from '../../common/redacting-logger';

@Injectable()
export class EligibilityService {
  constructor(
    private readonly routing: RoutingService,
    private readonly ledger: LedgerService,
  ) {}

  async check(input: Omit<EligibilityInquiry, 'schemaVersion' | 'correlationId' | 'origin'>,
              correlationId?: string): Promise<{ transactionId: string; outcome: EligibilityOutcome }> {
    const ctx = requireTenant();
    this.enforceChannelPolicy(ctx.channel, input);

    const inquiry: EligibilityInquiry = {
      schemaVersion: 'v1',
      correlationId: correlationId ?? randomUUID(),
      origin: { channel: ctx.channel, initiatorRef: ctx.initiatorRef, tenantId: ctx.tenantId },
      ...input,
    };

    const log = txLogger({ correlationId: inquiry.correlationId, tenantId: ctx.tenantId });
    const startedAt = Date.now();

    const txId = await this.ledger.open({
      type: 'eligibility',
      origin: inquiry.origin,
      correlationId: inquiry.correlationId,
      payerId: inquiry.payer.id,
      canonicalRequest: inquiry,
      dateOfService: inquiry.dateOfService,
    });

    const { network, config } = await this.routing.route(inquiry.payer.id, 'eligibility');
    await this.ledger.markRouted(txId, network.name);
    log.info({ txId, network: network.name, payerId: inquiry.payer.id }, 'eligibility routed');

    const breaker = this.routing.breaker(network.name);
    try {
      const result = await network.checkEligibility(inquiry, config);
      breaker.recordSuccess();

      const terminal =
        result.outcome.status === 'payer_rejected' ? 'payer_rejected' as const : 'responded' as const;

      await this.ledger.complete(txId, {
        status: terminal,
        canonicalResponse: result.outcome,
        rawRequest: result.rawRequest,
        rawResponse: result.rawResponse,
        latencyTotalMs: Date.now() - startedAt,
        latencyDownstreamMs: result.outcome.meta.downstreamLatencyMs,
      });
      log.info({ txId, status: result.outcome.status,
                 downstreamMs: result.outcome.meta.downstreamLatencyMs }, 'eligibility completed');
      return { transactionId: txId, outcome: result.outcome };
    } catch (err: any) {
      breaker.recordFailure();
      const status = err?.name === 'TimeoutError' ? 'timeout' as const : 'failed' as const;
      await this.ledger.complete(txId, {
        status,
        error: { message: err?.message ?? 'unknown', network: network.name }, // codes only, no PHI
        latencyTotalMs: Date.now() - startedAt,
      });
      log.error({ txId, err: err?.message }, 'eligibility failed');
      throw err;
    }
  }


  /**
   * RE-VERIFY: resubmit a past inquiry as a brand-new transaction.
   * The original request is decrypted SERVER-SIDE — patient details
   * never round-trip through the browser for a resubmission.
   */
  async reverify(txId: string): Promise<{ transactionId: string; outcome: EligibilityOutcome }> {
    const original = await this.ledger.getRequest<EligibilityInquiry>(txId);
    if (!original) throw new Error('Original request not found for re-verification');
    const { schemaVersion, correlationId, origin, ...fields } = original;
    return this.check(fields);
  }

  /**
   * Channel policy: patients may only query THEIR OWN coverage.
   * The patient's verified member bindings live in patient_identities;
   * the requested subscriber must match one of them.
   */
  private enforceChannelPolicy(channel: string, input: { subscriber: { memberId: string } }): void {
    if (channel === 'patient') {
      // TODO: load member_binding for ctx.initiatorRef and compare with
      // input.subscriber (memberId + DOB). Reject on mismatch:
      // throw new ForbiddenException('Patients may only query their own coverage');
      void ForbiddenException;
    }
  }
}
