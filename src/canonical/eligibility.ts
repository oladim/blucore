/** CANONICAL 270/271 — schema v1 */

import {
  ISODate, ISODateTime, Origin, PayerRef, ProviderRef,
  SubscriberRef, DependentRef,
} from './common';
import { Benefit, PlanInfo } from './benefit';
import { NormalizedRejection } from './rejection';

export interface EligibilityInquiry {
  schemaVersion: 'v1';
  correlationId: string;
  origin: Origin;
  payer: PayerRef;
  provider: ProviderRef;
  subscriber: SubscriberRef;
  dependent?: DependentRef;
  /** X12 service type codes; default ['30'] = health benefit plan coverage */
  serviceTypeCodes: string[];
  dateOfService?: ISODate;
}

export type EligibilityStatus =
  | 'active' | 'inactive'
  | 'payer_rejected' | 'network_error' | 'timeout';

export interface EligibilityOutcome {
  schemaVersion: 'v1';
  correlationId: string;
  status: EligibilityStatus;
  plan?: PlanInfo;
  benefits: Benefit[];
  rejections: NormalizedRejection[];
  meta: {
    network: string;              // 'stedi'
    downstreamLatencyMs: number;
    receivedAt: ISODateTime;
  };
}
