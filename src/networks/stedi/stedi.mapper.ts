/**
 * STEDI MAPPER — canonical ⇄ Stedi Healthcare JSON.
 * ─────────────────────────────────────────────────────────────────
 * The ONLY file allowed to know Stedi's shapes. Every quirk you
 * discover in a payer's 271 becomes a fixture in test/fixtures and
 * a case here. Verify field names against the current Stedi API
 * reference (https://www.stedi.com/docs) before go-live — treat the
 * shapes below as scaffolding, not gospel.
 */
import { EligibilityInquiry, EligibilityOutcome } from '../../canonical/eligibility';
import { Benefit, BenefitInfoType, CoverageLevel, NetworkIndicator, TimePeriod } from '../../canonical/benefit';
import { NormalizedRejection } from '../../canonical/rejection';

// ── outbound: canonical 270 → Stedi eligibility request ─────────
export function toStediEligibilityRequest(inq: EligibilityInquiry, routeConfig: Record<string, unknown>) {
  return {
    controlNumber: inq.correlationId.replace(/-/g, '').slice(0, 9),
    tradingPartnerServiceId: String(routeConfig.stediPayerId ?? ''), // from payer_routes.config
    provider: {
      organizationName: inq.provider.organizationName,
      firstName: inq.provider.firstName,
      lastName: inq.provider.lastName,
      npi: inq.provider.npi,
    },
    subscriber: {
      memberId: inq.subscriber.memberId,
      firstName: inq.subscriber.firstName,
      lastName: inq.subscriber.lastName,
      dateOfBirth: inq.subscriber.dateOfBirth.replace(/-/g, ''),
    },
    dependents: inq.dependent ? [{
      firstName: inq.dependent.firstName,
      lastName: inq.dependent.lastName,
      dateOfBirth: inq.dependent.dateOfBirth.replace(/-/g, ''),
    }] : undefined,
    encounter: {
      serviceTypeCodes: inq.serviceTypeCodes,
      ...(inq.dateOfService ? { dateOfService: inq.dateOfService.replace(/-/g, '') } : {}),
    },
  };
}

// ── inbound: Stedi 271 → canonical outcome ──────────────────────
export function fromStedi271(correlationId: string, body: any, downstreamLatencyMs: number): EligibilityOutcome {
  const rejections = mapAAARejections(body);
  const benefits = (body?.benefitsInformation ?? []).map(mapBenefit);
  const active = benefits.some((b: Benefit) => b.infoType === 'active_coverage');
  const inactive = benefits.some((b: Benefit) => b.infoType === 'inactive');

  // Plan name: payers rarely send planInformation; the human-readable
  // name usually rides on the active-coverage EB row (EB05), e.g.
  // "Open Access Plus" — prefer general coverage (STC 30), else any.
  const planFromBenefits =
    benefits.find((b: Benefit) => b.infoType === 'active_coverage'
      && b.planDescription && b.serviceTypeCodes.includes('30'))?.planDescription
    ?? benefits.find((b: Benefit) => b.infoType === 'active_coverage' && b.planDescription)?.planDescription;

  return {
    schemaVersion: 'v1',
    correlationId,
    status: rejections.length > 0 ? 'payer_rejected'
      : active ? 'active'
      : inactive ? 'inactive'
      : benefits.length === 0 ? 'payer_rejected'   // empty 271: never claim coverage
      : 'active',
    plan: {
      planName: body?.planInformation?.planDescription ?? planFromBenefits,
      groupNumber: body?.planInformation?.groupNumber
        ?? body?.subscriber?.groupNumber ?? body?.planInformation?.groupDescription,
      payerName: body?.payer?.name,
    },
    benefits,
    rejections,
    meta: { network: 'stedi', downstreamLatencyMs, receivedAt: new Date().toISOString() },
  };
}

const EB01_MAP: Record<string, BenefitInfoType> = {
  '1': 'active_coverage', '6': 'inactive', 'A': 'co_insurance', 'B': 'co_payment',
  'C': 'deductible', 'G': 'out_of_pocket_max', 'F': 'limitation',
  'D': 'benefit_description', 'I': 'non_covered', 'CB': 'prior_auth_required',
};
const EB02_MAP: Record<string, CoverageLevel> = {
  IND: 'individual', FAM: 'family', EMP: 'employee_only',
  ESP: 'employee_spouse', ECH: 'employee_children',
};
const EB06_MAP: Record<string, TimePeriod> = {
  '23': 'calendar_year', '25': 'plan_year', '27': 'visit', '26': 'day',
  '30': 'lifetime', '29': 'remaining', '36': 'admission',
};

function mapBenefit(eb: any): Benefit {
  const value =
    eb.benefitAmount != null
      ? { kind: 'monetary' as const, amount: Number(eb.benefitAmount), currency: 'USD' as const }
      : eb.benefitPercent != null
        ? { kind: 'percentage' as const, percent: Number(eb.benefitPercent) * 100 }
        : eb.benefitQuantity != null
          ? { kind: 'quantity' as const, count: Number(eb.benefitQuantity),
              qualifier: String(eb.quantityQualifierCode ?? '') }
          : { kind: 'none' as const };

  const netCode = eb.inPlanNetworkIndicatorCode;
  const network: NetworkIndicator =
    netCode === 'Y' ? 'in_network' : netCode === 'N' ? 'out_of_network'
    : netCode === 'W' ? 'both' : 'unknown';

  return {
    infoType: EB01_MAP[eb.code] ?? 'other',
    coverageLevel: EB02_MAP[eb.coverageLevelCode] ?? 'unknown',
    serviceTypeCodes: eb.serviceTypeCodes ?? (eb.serviceTypeCode ? [eb.serviceTypeCode] : []),
    network,
    timePeriod: EB06_MAP[eb.timeQualifierCode] ?? 'unknown',
    value,
    planDescription: eb.planCoverage,
    authorizationRequired: eb.authOrCertIndicator === 'Y' ? true : undefined,
    messages: eb.additionalInformation?.map((m: any) => m.description) ?? undefined,
  };
}

// ── AAA segments → normalized rejection taxonomy ────────────────
const AAA_MAP: Record<string, Pick<NormalizedRejection, 'category' | 'action' | 'message'>> = {
  '72': { category: 'invalid_member_details', action: 'correct_and_resubmit',
          message: 'Member ID appears invalid — verify the ID on the insurance card.' },
  '73': { category: 'invalid_member_details', action: 'correct_and_resubmit',
          message: 'Member name does not match payer records — check spelling.' },
  '75': { category: 'member_not_found', action: 'correct_and_resubmit',
          message: 'Member not found — verify member ID, name, and date of birth.' },
  '71': { category: 'invalid_member_details', action: 'correct_and_resubmit',
          message: 'Date of birth does not match payer records.' },
  '79': { category: 'payer_unavailable', action: 'retry_later',
          message: 'Trouble connecting to this payer — retry shortly; contact support if it persists.' },
  '43': { category: 'invalid_provider', action: 'enroll_provider',
          message: 'Provider not eligible for inquiries with this payer.' },
  '42': { category: 'payer_unavailable', action: 'retry_later',
          message: 'Payer system temporarily unavailable — retry shortly.' },
  '80': { category: 'payer_unavailable', action: 'retry_later',
          message: 'Payer could not process the request — retry shortly.' },
};

function mapAAARejections(body: any): NormalizedRejection[] {
  const errors: any[] = body?.errors ?? [];
  return errors.map((e) => {
    const known = AAA_MAP[e.code];
    return {
      category: known?.category ?? 'unknown',
      action: known?.action ?? 'contact_payer',
      message: known?.message ?? 'The payer rejected this inquiry.',
      sourceCodes: [String(e.code ?? ''), String(e.followupAction ?? '')].filter(Boolean),
      source: 'payer' as const,
    };
  });
}
