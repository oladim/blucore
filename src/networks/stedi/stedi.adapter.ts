/**
 * STEDI ADAPTER — first implementation of ClearinghouseNetwork.
 * Owns: transport, retry policy for retryable failures, webhook
 * signature verification. Delegates all shape knowledge to mapper.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ClearinghouseNetwork, NetworkResult } from '../network.interface';
import { NetworkRegistry } from '../network.registry';
import { EligibilityInquiry, EligibilityOutcome } from '../../canonical/eligibility';
import { ClaimStatusInquiry, ClaimStatusOutcome } from '../../canonical/claim-status';
import { StediClient } from './stedi.client';
import { toStediEligibilityRequest, fromStedi271 } from './stedi.mapper';

class TimeoutError extends Error { name = 'TimeoutError'; }

@Injectable()
export class StediAdapter implements ClearinghouseNetwork, OnModuleInit {
  readonly name = 'stedi';
  readonly capabilities = ['eligibility', 'claim_status'] as const;

  private readonly client = new StediClient();

  constructor(private readonly registry: NetworkRegistry) {}

  onModuleInit() { this.registry.register(this); }

  async checkEligibility(
    inquiry: EligibilityInquiry,
    routeConfig: Record<string, unknown>,
  ): Promise<NetworkResult<EligibilityOutcome>> {
    const stediReq = toStediEligibilityRequest(inquiry, routeConfig);
    const started = Date.now();

    let res;
    try {
      res = await this.client.post('/change/medicalnetwork/eligibility/v3', stediReq);
    } catch (e: any) {
      if (e?.code === 'UND_ERR_HEADERS_TIMEOUT' || e?.code === 'UND_ERR_BODY_TIMEOUT') {
        throw new TimeoutError(`Stedi eligibility timed out for payer ${inquiry.payer.id}`);
      }
      throw e;
    }
    const downstreamMs = Date.now() - started;

    if (res.status >= 500) {
      throw new Error(`Stedi returned ${res.status}`); // retryable — breaker counts it
    }
    if (res.status >= 400) {
      // Auth/validation failure at the network — NEVER map to a coverage answer.
      const outcome: EligibilityOutcome = {
        schemaVersion: 'v1',
        correlationId: inquiry.correlationId,
        status: 'network_error',
        benefits: [],
        rejections: [{
          category: res.status === 401 || res.status === 403 ? 'invalid_request' : 'network_error',
          action: 'do_not_retry',
          message: `Clearinghouse network rejected the request (HTTP ${res.status}). Check network credentials/configuration.`,
          sourceCodes: [String(res.status)],
          source: 'network',
        }],
        meta: { network: 'stedi', downstreamLatencyMs: downstreamMs, receivedAt: new Date().toISOString() },
      };
      return { outcome, rawRequest: JSON.stringify(stediReq), rawResponse: res.raw };
    }

    const outcome = fromStedi271(inquiry.correlationId, res.body, downstreamMs);
    return {
      outcome,
      rawRequest: JSON.stringify(stediReq),
      rawResponse: res.raw,
    };
  }

  async checkClaimStatus(
    inquiry: ClaimStatusInquiry,
    _routeConfig: Record<string, unknown>,
  ): Promise<NetworkResult<ClaimStatusOutcome>> {
    // TODO: mirror eligibility using Stedi claim-status endpoint + fromStedi277 mapper.
    throw new Error(`Stedi claim status not yet implemented (correlation ${inquiry.correlationId})`);
  }

  /** Stedi authenticates TO you with a shared-secret header configured
   *  in its webhook credential set (not an HMAC signature). Header name
   *  must match the credential set exactly. */
  verifyWebhook(headers: Record<string, string>, _rawBody: string): boolean {
    const secret = process.env.STEDI_WEBHOOK_SECRET ?? '';
    const presented = headers['x-webhook-secret'] ?? '';
    if (!secret || !presented) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
