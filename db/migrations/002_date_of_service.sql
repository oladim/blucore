-- Promote date_of_service to a queryable column so the worklist can be
-- scoped by schedule (Today / +3 / +5 / +7 / custom). A bare date is
-- low-sensitivity metadata; identifying fields remain encrypted.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS date_of_service date;
CREATE INDEX IF NOT EXISTS idx_tx_tenant_dos
  ON transactions (tenant_id, date_of_service, created_at DESC);
