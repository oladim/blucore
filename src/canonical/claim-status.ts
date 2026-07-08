/** CANONICAL 276/277 — schema v1 */

import {
  ISODate, ISODateTime, Origin, PayerRef, ProviderRef,
  SubscriberRef, DependentRef, DateRange,
} from './common';
import { NormalizedRejection } from './rejection';

export interface ClaimStatusInquiry {
  schemaVersion: 'v1';
  correlationId: string;
  origin: Origin;
  payer: PayerRef;
  provider: ProviderRef;
  subscriber: SubscriberRef;
  dependent?: DependentRef;
  claim: {
    payerClaimNumber?: string;    // fastest match when known
    patientAccountNumber?: string;
    serviceDates: DateRange;
    chargeAmount?: number;
  };
}

/** Normalized from X12 claim status category codes (STC) */
export type ClaimStatusCategory =
  | 'acknowledged' | 'pending' | 'finalized_paid'
  | 'finalized_denied' | 'returned' | 'not_found' | 'unknown';

export interface ClaimStatusDetail {
  category: ClaimStatusCategory;
  statusCode: string;             // raw category code (e.g. 'F1')
  statusDescription: string;
  effectiveDate?: ISODate;
  paidAmount?: number;
  checkNumber?: string;
  checkDate?: ISODate;
}

export interface ClaimStatusOutcome {
  schemaVersion: 'v1';
  correlationId: string;
  status: 'responded' | 'payer_rejected' | 'network_error' | 'timeout' | 'pending_async';
  claims: ClaimStatusDetail[];
  rejections: NormalizedRejection[];
  meta: { network: string; downstreamLatencyMs: number; receivedAt: ISODateTime };
}
