/**
 * CANONICAL PRIMITIVES — schema v1
 * ─────────────────────────────────────────────────────────────────
 * This directory is the heart of the platform. It imports NOTHING
 * from core/, networks/, or transport code (enforced by
 * dependency-cruiser). Both future PMS adapters (northbound) and
 * network adapters (southbound) map INTO and OUT OF these types.
 *
 * Treat any change here as a breaking API change: version it.
 */

export type ISODate = string;      // YYYY-MM-DD
export type ISODateTime = string;  // RFC 3339

export type TransactionType = 'eligibility' | 'claim_status';

/** Who initiated the transaction — drives authorization rules. */
export type OriginChannel = 'patient' | 'pms' | 'internal';

export interface Origin {
  channel: OriginChannel;
  /** api_key id (pms) | patient_identity id (patient) | user id (internal) */
  initiatorRef: string;
  tenantId: string;
}

export interface PayerRef {
  /** OUR payer id — resolved to network-specific ids via the payer directory */
  id: string;
}

/** The healthcare provider on whose behalf the inquiry is made (X12 loop 2100B) */
export interface ProviderRef {
  npi: string;
  organizationName?: string;
  firstName?: string;
  lastName?: string;
  taxId?: string;
}

export interface SubscriberRef {
  memberId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: ISODate;
  groupNumber?: string;
}

export interface DependentRef {
  firstName: string;
  lastName: string;
  dateOfBirth: ISODate;
  relationshipCode?: '01' | '19' | '34' | 'G8'; // spouse, child, other adult, other
}

export interface DateRange {
  start: ISODate;
  end?: ISODate;
}
