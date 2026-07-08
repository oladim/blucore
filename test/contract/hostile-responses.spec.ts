/**
 * HOSTILE FIXTURES — the "never wrong-but-confident" suite.
 * Born from a real incident: an unauthenticated Stedi call mapped to
 * status 'active' with zero benefits. These tests make that class of
 * bug a permanent CI failure.
 */
import { fromStedi271 } from '../../src/networks/stedi/stedi.mapper';

describe('hostile 271 responses never claim coverage', () => {
  it('empty body (auth-failure shape) must not map to active', () => {
    const out = fromStedi271('00000000-0000-0000-0000-000000000001', { message: 'Unauthorized' }, 100);
    expect(out.status).not.toBe('active');
    expect(out.benefits).toHaveLength(0);
  });

  it('271 with zero benefits and zero errors must not claim active', () => {
    const out = fromStedi271('00000000-0000-0000-0000-000000000002',
      { benefitsInformation: [], errors: [] }, 100);
    expect(out.status).toBe('payer_rejected');
  });

  it('AAA 79 is a retryable connectivity problem, not provider enrollment', () => {
    const out = fromStedi271('00000000-0000-0000-0000-000000000003',
      { benefitsInformation: [], errors: [{ code: '79', followupAction: 'N' }] }, 100);
    expect(out.status).toBe('payer_rejected');
    expect(out.rejections[0].category).toBe('payer_unavailable');
    expect(out.rejections[0].action).toBe('retry_later');
  });

  it('benefits alongside AAA errors still means rejected (vendor guidance)', () => {
    const out = fromStedi271('00000000-0000-0000-0000-000000000004', {
      benefitsInformation: [{ code: '1', coverageLevelCode: 'IND', serviceTypeCodes: ['30'] }],
      errors: [{ code: '75' }],
    }, 100);
    expect(out.status).toBe('payer_rejected');
  });
});
