-- ============================================================================
-- 001_init.sql — Clearinghouse system of record
--
-- Design invariants:
--   1. Every PHI-bearing row carries tenant_id NOT NULL.
--   2. Row-Level Security is the isolation BACKSTOP; app code also filters.
--   3. PHI columns store ciphertext (app-level AES-256-GCM, envelope keys).
--      The database never sees plaintext member data.
--   4. transactions is append-heavy and time-queried => partition-ready.
--   5. origin_channel distinguishes PATIENT-initiated vs PMS-initiated vs
--      internal traffic — different authz rules apply per channel.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────── Tenancy ───────────────────────────
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('practice','pms_vendor','internal')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  hashed_key      text NOT NULL,                  -- SHA-256; plaintext shown once
  label           text NOT NULL,
  scopes          text[] NOT NULL,                -- e.g. {eligibility:write,transactions:read}
  rate_limit_pm   int  NOT NULL DEFAULT 300,      -- per-minute, per-key
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_api_keys_hash ON api_keys(hashed_key) WHERE status = 'active';

-- Patient identities (patient-portal channel). Patients may ONLY query
-- coverage bound to their own verified identity — enforced in authz layer.
CREATE TABLE patient_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  external_ref    text NOT NULL,                  -- your auth provider's subject id
  member_binding  jsonb NOT NULL,                 -- ENCRYPTED: verified memberId/DOB bindings
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_ref)
);

-- ─────────────────────── Payer directory / routing ───────────────────────
CREATE TABLE payers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  external_ids  jsonb NOT NULL DEFAULT '{}',      -- {"stedi":"AETNA", "availity":"..."}
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payer_routes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id           uuid NOT NULL REFERENCES payers(id),
  network            text NOT NULL,               -- 'stedi', future: 'availity', ...
  transaction_types  text[] NOT NULL,             -- {eligibility, claim_status}
  priority           int  NOT NULL DEFAULT 100,   -- lower wins
  config             jsonb NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'active',
  UNIQUE (payer_id, network)
);
CREATE INDEX idx_routes_payer ON payer_routes(payer_id, priority) WHERE status = 'active';

-- ─────────────────────────── Transaction ledger ───────────────────────────
-- The arbiter of every dispute. Partition by month when volume warrants:
--   ALTER TABLE transactions ... PARTITION BY RANGE (created_at);
CREATE TABLE transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  correlation_id        uuid NOT NULL,
  idempotency_key       text,

  type                  text NOT NULL CHECK (type IN ('eligibility','claim_status')),

  -- WHO initiated this — patient vs PMS vs internal UI. Drives authz + analytics.
  origin_channel        text NOT NULL CHECK (origin_channel IN ('patient','pms','internal')),
  initiator_ref         text NOT NULL,            -- api_key id | patient_identity id | user id

  payer_id              uuid REFERENCES payers(id),
  network               text,                     -- resolved route: 'stedi'
  status                text NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received','routed','sent','responded',
                                          'payer_rejected','failed','timeout')),

  -- PHI payloads: ciphertext bytea + key version for rotation
  request_canonical_enc  bytea,
  response_canonical_enc bytea,
  raw_request_enc        bytea,                   -- network wire payload; purgeable
  raw_response_enc       bytea,                   -- purgeable
  phi_key_version        int NOT NULL DEFAULT 1,

  error                 jsonb,                    -- normalized rejection taxonomy (NO PHI)
  latency_total_ms      int,
  latency_downstream_ms int,

  created_at            timestamptz NOT NULL DEFAULT now(),
  responded_at          timestamptz,
  raw_purged_at         timestamptz
);

CREATE INDEX idx_tx_tenant_time ON transactions (tenant_id, created_at DESC);
CREATE INDEX idx_tx_correlation ON transactions (correlation_id);
CREATE INDEX idx_tx_payer_status ON transactions (payer_id, status, created_at DESC);
CREATE UNIQUE INDEX idx_tx_idempotency ON transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Status timeline for debugging/support ("where did my check get stuck?")
CREATE TABLE transaction_events (
  id              bigserial PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES transactions(id),
  tenant_id       uuid NOT NULL,
  status          text NOT NULL,
  detail          jsonb,                          -- NO PHI — codes and timings only
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_events ON transaction_events (transaction_id, occurred_at);

-- ─────────────────────────── Audit (HIPAA §164.312(b)) ───────────────────
-- Append-only. Revoke UPDATE/DELETE from the app role.
CREATE TABLE audit_events (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  actor_type      text NOT NULL,                  -- 'api_key' | 'patient' | 'user' | 'system'
  actor_ref       text NOT NULL,
  action          text NOT NULL,                  -- 'phi.read' | 'phi.write' | 'tx.create' ...
  transaction_id  uuid,
  metadata        jsonb,                          -- NO PHI
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_time ON audit_events (tenant_id, occurred_at DESC);

-- ─────────────────────── Row-Level Security backstop ─────────────────────
-- App sets per-request:  SET LOCAL app.tenant_id = '<uuid>';
-- Even a buggy query CANNOT cross tenants.
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys            ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_identities  ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tx      ON transactions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_txe     ON transaction_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_audit   ON audit_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_keys    ON api_keys
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_patient ON patient_identities
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- The app connects as a NON-superuser role so RLS applies:
--   CREATE ROLE app_rw LOGIN PASSWORD '...';
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
--   REVOKE UPDATE, DELETE ON audit_events, transaction_events FROM app_rw;
-- Auth lookups (before tenant is known) run through a SECURITY DEFINER
-- function or a separate auth role limited to api_keys by hashed_key.
