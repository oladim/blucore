/**
 * CANONICAL BENEFIT MODEL (normalized X12 271 EB segments)
 * ─────────────────────────────────────────────────────────────────
 * The hardest mapping surface in the system. An EB segment is a
 * combinatorial beast: one code axis says WHAT kind of info
 * (active coverage? co-pay? deductible remaining?), others say for
 * WHOM (individual/family), WHERE (in/out of network), for WHICH
 * services, over WHAT period, at WHAT amount. We decompose that
 * into one flat, queryable record per benefit statement.
 */

import { DateRange } from './common';

/** EB01 — what kind of statement this row is */
export type BenefitInfoType =
  | 'active_coverage'        // EB01=1
  | 'inactive'               // EB01=6
  | 'co_payment'             // EB01=B
  | 'co_insurance'           // EB01=A
  | 'deductible'             // EB01=C
  | 'out_of_pocket_max'      // EB01=G
  | 'limitation'             // EB01=F
  | 'benefit_description'    // EB01=D
  | 'non_covered'            // EB01=I
  | 'prior_auth_required'    // EB01=CB (paired w/ AuthInfo)
  | 'other';

/** EB02 — coverage level */
export type CoverageLevel =
  | 'individual'             // IND
  | 'family'                 // FAM
  | 'employee_only'          // EMP
  | 'employee_spouse'        // ESP
  | 'employee_children'      // ECH
  | 'unknown';

/** EB06 — time period the amount applies to */
export type TimePeriod =
  | 'calendar_year' | 'plan_year' | 'visit' | 'day'
  | 'lifetime' | 'remaining' | 'admission' | 'unknown';

export type NetworkIndicator = 'in_network' | 'out_of_network' | 'both' | 'unknown';

/** Exactly one of these value shapes applies, depending on infoType */
export type BenefitValue =
  | { kind: 'monetary'; amount: number; currency: 'USD' }        // EB07
  | { kind: 'percentage'; percent: number }                      // EB08 (coinsurance)
  | { kind: 'quantity'; count: number; qualifier: string }       // EB09/EB10 (visits etc.)
  | { kind: 'none' };                                            // pure status rows

export interface Benefit {
  infoType: BenefitInfoType;
  coverageLevel: CoverageLevel;
  /** X12 service type codes this row applies to ('30' general, '98' office visit, ...) */
  serviceTypeCodes: string[];
  network: NetworkIndicator;
  timePeriod: TimePeriod;
  value: BenefitValue;
  planDescription?: string;       // EB05 free text
  authorizationRequired?: boolean;
  dates?: DateRange;
  messages?: string[];            // MSG segments attached to this EB
}

export interface PlanInfo {
  planName?: string;
  groupNumber?: string;
  coverage?: DateRange;           // plan begin/end
  payerName?: string;
  insuranceType?: string;         // EB04 (HM, PR, MC, ...)
}
