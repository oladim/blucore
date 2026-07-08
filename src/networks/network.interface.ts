/**
 * SOUTHBOUND PORT — the ClearinghouseNetwork contract.
 * ─────────────────────────────────────────────────────────────────
 * Stedi is the first implementation, never a special case. The core
 * depends ONLY on this interface (dependency-cruiser enforces it).
 * Every implementation must pass test/contract/network.contract.ts.
 */

import { TransactionType } from '../canonical/common';
import { EligibilityInquiry, EligibilityOutcome } from '../canonical/eligibility';
import { ClaimStatusInquiry, ClaimStatusOutcome } from '../canonical/claim-status';

export interface NetworkResult<T> {
  outcome: T;
  /** Wire payloads preserved for audit/disputes. Encrypted before persistence. */
  rawRequest: string;
  rawResponse: string;
}

export interface ClearinghouseNetwork {
  readonly name: string; // 'stedi'
  readonly capabilities: ReadonlyArray<TransactionType>;

  checkEligibility(
    inquiry: EligibilityInquiry,
    routeConfig: Record<string, unknown>, // per-payer overrides from payer_routes.config
  ): Promise<NetworkResult<EligibilityOutcome>>;

  checkClaimStatus(
    inquiry: ClaimStatusInquiry,
    routeConfig: Record<string, unknown>,
  ): Promise<NetworkResult<ClaimStatusOutcome>>;

  /** Verify inbound webhook authenticity (async 277 flows). */
  verifyWebhook?(headers: Record<string, string>, rawBody: string): boolean;
}
