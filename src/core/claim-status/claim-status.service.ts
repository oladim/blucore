/**
 * CLAIM STATUS ORCHESTRATOR (276/277)
 * Sync path mirrors eligibility. Async 277 flows land via the
 * network webhook → queue → this service's completeAsync().
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClaimStatusInquiry, ClaimStatusOutcome } from '../../canonical/claim-status';
import { requireTenant } from '../../tenancy/tenant-context';
import { RoutingService } from '../routing/routing.service';
import { LedgerService } from '../transactions/ledger.service';
import { DeliveryService } from '../delivery/delivery.service';
import { txLogger } from '../../common/redacting-logger';

@Injectable()
export class ClaimStatusService {
  constructor(
    private readonly routing: RoutingService,
    private readonly ledger: LedgerService,
    private readonly delivery: DeliveryService,
  ) {}

  async check(input: Omit<ClaimStatusInquiry, 'schemaVersion' | 'correlationId' | 'origin'>,
              correlationId?: string): Promise<{ transactionId: string; outcome: ClaimStatusOutcome }> {
    const ctx = requireTenant();
    const inquiry: ClaimStatusInquiry = {
      schemaVersion: 'v1',
      correlationId: correlationId ?? randomUUID(),
      origin: { channel: ctx.channel, initiatorRef: ctx.initiatorRef, tenantId: ctx.tenantId },
      ...input,
    };

    const log = txLogger({ correlationId: inquiry.correlationId, tenantId: ctx.tenantId });
    const startedAt = Date.now();

    const txId = await this.ledger.open({
      type: 'claim_status',
      origin: inquiry.origin,
      correlationId: inquiry.correlationId,
      payerId: inquiry.payer.id,
      canonicalRequest: inquiry,
    });

    const { network, config } = await this.routing.route(inquiry.payer.id, 'claim_status');
    await this.ledger.markRouted(txId, network.name);

    const breaker = this.routing.breaker(network.name);
    try {
      const result = await network.checkClaimStatus(inquiry, config);
      breaker.recordSuccess();

      if (result.outcome.status === 'pending_async') {
        // Payer will answer later via webhook; client polls GET /:id
        log.info({ txId }, 'claim status pending async 277');
        return { transactionId: txId, outcome: result.outcome };
      }

      await this.ledger.complete(txId, {
        status: result.outcome.status === 'payer_rejected' ? 'payer_rejected' : 'responded',
        canonicalResponse: result.outcome,
        rawRequest: result.rawRequest,
        rawResponse: result.rawResponse,
        latencyTotalMs: Date.now() - startedAt,
        latencyDownstreamMs: result.outcome.meta.downstreamLatencyMs,
      });
      return { transactionId: txId, outcome: result.outcome };
    } catch (err: any) {
      breaker.recordFailure();
      await this.ledger.complete(txId, {
        status: err?.name === 'TimeoutError' ? 'timeout' : 'failed',
        error: { message: err?.message ?? 'unknown', network: network.name },
        latencyTotalMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  /** Invoked by the webhook worker when an async 277 arrives. */
  async completeAsync(tenantId: string, txId: string, outcome: ClaimStatusOutcome,
                      rawResponse: string): Promise<void> {
    // Worker path: tenant known from the ledger row, not from a request.
    // ledger has a system variant mirroring complete(); after persisting,
    // hand the result to DeliveryService (sync-poll today, webhook-push later).
    await this.delivery.deliver(tenantId, txId, outcome);
  }
}
