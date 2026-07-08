/**
 * NORMALIZED REJECTION TAXONOMY
 * ─────────────────────────────────────────────────────────────────
 * Payers reject via AAA segments with cryptic codes. Raw relay of
 * those codes turns every front-desk confusion into OUR support
 * ticket. Every network adapter must map its errors into this
 * taxonomy; the `action` field tells the client what to actually do.
 */

export type RejectionCategory =
  | 'member_not_found'          // AAA 72/73/75 family
  | 'invalid_member_details'    // DOB/name mismatch — fixable at front desk
  | 'invalid_provider'          // NPI not recognized/enrolled with payer
  | 'payer_enrollment_required' // provider must register with payer first
  | 'invalid_request'           // our/client validation gap
  | 'payer_unavailable'         // AAA 42/80, payer system down — retryable
  | 'not_supported'             // payer doesn't support this transaction/STC
  | 'network_error'             // Stedi/transport failure — retryable
  | 'timeout'
  | 'unknown';

export type SuggestedAction =
  | 'correct_and_resubmit'      // fix member/provider details
  | 'retry_later'               // transient payer/network issue
  | 'contact_payer'
  | 'enroll_provider'
  | 'do_not_retry';

export interface NormalizedRejection {
  category: RejectionCategory;
  action: SuggestedAction;
  /** Human-readable, front-desk-safe message. NEVER include PHI. */
  message: string;
  /** Original code(s) for support/debugging (e.g. AAA reject reason '75') */
  sourceCodes: string[];
  /** Where the rejection originated */
  source: 'payer' | 'network' | 'clearinghouse';
}
