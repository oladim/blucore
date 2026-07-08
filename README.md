# Clearinghouse Backend

Healthcare EDI clearinghouse core: real-time eligibility (270/271) and claim
status (276/277), brokered between clients (frontend, patients, future PMS
integrations) and downstream networks — **Stedi first, never Stedi-coupled**.

```
 Patients ──┐                                       ┌── Stedi ──► Payers
 PMS (later)┤──► API tier ──► CANONICAL CORE ──► Routing ──┤── Network #2 (later)
 Frontend ──┘   (stateless)   ledger · authz · audit       └── ...
```

## Architectural invariants (enforced, not conventions)

| Invariant | Enforcement |
|---|---|
| Core never imports network internals | `.dependency-cruiser.cjs` in CI |
| Canonical schema imports nothing | same |
| Cross-tenant reads impossible | Postgres **RLS** + `SET LOCAL app.tenant_id` (`db.service.ts`) + `test/tenant-isolation` |
| PHI never in logs | allowlist redaction (`redacting-logger.ts`) + **PHI canary test** fails CI on leak |
| PHI encrypted at rest | AES-256-GCM, versioned keys (`crypto.service.ts`); DB never sees plaintext |
| Every adapter behaves identically | `test/contract/network.contract.spec.ts` |
| Origin channel recorded on every tx | `origin_channel` (`patient` / `pms` / `internal`) — drives authz: patients query **only their own** coverage |

## Layout

```
src/canonical/    Schema v1 — the heart. Benefit model, rejection taxonomy.
src/core/         Orchestrators: eligibility, claim-status, routing, ledger, delivery.
src/networks/     Southbound port + Stedi adapter/mapper/webhook.
src/tenancy/      Auth guard (3 channels), tenant context, RLS-enforcing DB.
src/common/       Redacting logger, PHI crypto, idempotency, circuit breaker, correlation.
src/queues/       BullMQ: inbound webhooks + rate-limited Stedi outbound.
db/migrations/    Schema incl. RLS policies, audit tables, partition-ready ledger.
test/             Mapper fixtures (crown jewels), contract suite, PHI canary, isolation.
```

## Run locally

```bash
docker compose up -d                  # postgres + pgbouncer + redis
cp .env.example .env                  # then set:
node -p "require('crypto').randomBytes(32).toString('base64')"   # → PHI_DATA_KEY_BASE64
npm install
npm run migrate
npm run start:dev                     # API tier
WORKER_MODE=true npm run start:api    # worker tier (separate process)
npm test                              # mapper + canary tests
```

## API surface (v1)

```
POST /v1/eligibility-checks        Idempotency-Key supported → 201 outcome
GET  /v1/eligibility-checks/:id    poll (also serves async results)
GET  /v1/payers                    supported-payer directory
GET  /v1/transactions              tenant-scoped history (metadata only, no PHI)
GET  /v1/transactions/:id/events   status timeline ("where did it get stuck?")
POST /v1/webhooks/stedi            signed inbound async 277s → queue
GET  /health · /ready
```

## Scaling model

Single image, two run modes: API pods autoscale on p95/connection count;
workers autoscale on queue depth. Stedi outbound queue is rate-limited to
contracted throughput (`STEDI_RATE_LIMIT_PER_SEC`) — backpressure is managed,
not accidental. Payer directory cached in Redis. Always connect through
pgbouncer; partition `transactions` monthly when volume warrants.

## Marked TODOs before production

1. **Verify Stedi request/response field names against current Stedi docs**
   (`stedi.mapper.ts`, `stedi.client.ts` are scaffolding shapes) and grow the
   fixture library from sandbox responses.
2. JWT verification for patient + staff channels (`auth.guard.ts`) against
   your IdP JWKS, and the patient self-only policy (`eligibility.service.ts`).
3. 276/277 flow: `fromStedi277` mapper + inbound worker → `completeAsync`.
4. KMS envelope decryption at boot (replace raw `PHI_DATA_KEY_BASE64` in prod).
5. Implement tenant-isolation integration suite against docker-compose PG.
6. Retention purge job for `raw_*_enc` columns; per-key rate-limit middleware.
7. Sign BAAs (each practice/PMS **and** Stedi) before real PHI flows.
