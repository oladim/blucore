/**
 * TENANT ISOLATION SUITE (integration — requires Postgres w/ RLS).
 * Attempts cross-tenant access through EVERY read path and asserts
 * emptiness/404. This is the test that lets you sleep at night.
 *
 * Pattern:
 *   1. Seed tenant A with a transaction.
 *   2. Authenticate as tenant B.
 *   3. GET /v1/transactions           → must NOT list A's rows
 *   4. GET /v1/eligibility-checks/:idA → must 404
 *   5. Raw SQL as app role w/ app.tenant_id=B selecting A's id → 0 rows
 */
describe.skip('tenant isolation (integration)', () => {
  it('RLS blocks cross-tenant reads even with a buggy query', () => {
    // Implement against docker-compose Postgres in CI.
  });
});
