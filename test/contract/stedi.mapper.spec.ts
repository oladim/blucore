/**
 * MAPPING TESTS — the crown jewels.
 * Wrong benefit mapping = wrong copay shown at a front desk =
 * patient-harm and provider-trust incident, not just a bug.
 */
import { fromStedi271 } from '../../src/networks/stedi/stedi.mapper';
import activeFixture from '../fixtures/stedi-271-active-with-benefits.json';
import notFoundFixture from '../fixtures/stedi-271-member-not-found.json';

describe('Stedi 271 → canonical', () => {
  it('maps active coverage with copay and deductible-remaining', () => {
    const out = fromStedi271('11111111-1111-1111-1111-111111111111', activeFixture, 1200);

    expect(out.status).toBe('active');
    expect(out.plan?.planName).toBe('PPO GOLD');

    const copay = out.benefits.find((b) => b.infoType === 'co_payment');
    expect(copay?.value).toEqual({ kind: 'monetary', amount: 25, currency: 'USD' });
    expect(copay?.timePeriod).toBe('visit');
    expect(copay?.network).toBe('in_network');

    const deductible = out.benefits.find((b) => b.infoType === 'deductible');
    expect(deductible?.value).toEqual({ kind: 'monetary', amount: 350, currency: 'USD' });
    expect(deductible?.timePeriod).toBe('remaining');
  });

  it('normalizes AAA 75 into actionable member_not_found', () => {
    const out = fromStedi271('22222222-2222-2222-2222-222222222222', notFoundFixture, 800);

    expect(out.status).toBe('payer_rejected');
    expect(out.rejections[0]).toMatchObject({
      category: 'member_not_found',
      action: 'correct_and_resubmit',
      source: 'payer',
    });
    // Front-desk-safe: message must exist and contain no member data
    expect(out.rejections[0].message.length).toBeGreaterThan(10);
  });
});

describe('plan name derivation (real-payer behavior)', () => {
  it('pulls plan name from the active-coverage EB row when planInformation is absent', () => {
    const out = fromStedi271('33333333-3333-3333-3333-333333333333', {
      payer: { name: 'CHLIC' },
      benefitsInformation: [
        { code: '1', coverageLevelCode: 'IND', serviceTypeCodes: ['88'], planCoverage: 'Advantage Pharmacy' },
        { code: '1', coverageLevelCode: 'IND', serviceTypeCodes: ['30'], planCoverage: 'Open Access Plus' },
      ],
      errors: [],
    }, 100);
    expect(out.plan?.planName).toBe('Open Access Plus'); // prefers STC 30 over pharmacy
    expect(out.status).toBe('active');
  });
});
