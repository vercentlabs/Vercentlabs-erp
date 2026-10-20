-- Finance MVP F9: Period close.
--
-- 1. A month is closed in steps — Open → Closing review → Closed → Locked — and who did each step, when, and the readiness it was closed
--    with (a snapshot of every check and the trial balance totals) are kept on the period. A closed or locked month is reopened only with
--    a reason, and who reopened it is kept.
-- 2. A readiness exception that can't be cleared before closing (a bank statement not received yet, a sub-ledger difference being
--    investigated) is acknowledged with a reason; the acknowledgement belongs to that check of that month and can be withdrawn.
-- 3. A financial year keeps its year-end closing entry (profit moved to retained earnings).
--
-- Posting into a month that isn't open is already refused by the database (tenant.accounting_validate_posted_entry), whatever posts it.
-- Additive and re-runnable.

ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS review_started_at timestamptz;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS review_started_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS close_snapshot jsonb;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.fiscal_periods ADD COLUMN IF NOT EXISTS reopen_reason text;

ALTER TABLE tenant.accounting_fiscal_years ADD COLUMN IF NOT EXISTS closing_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);

CREATE TABLE IF NOT EXISTS tenant.accounting_period_close_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fiscal_period_id uuid NOT NULL REFERENCES tenant.fiscal_periods(id) ON DELETE CASCADE,
  check_key text NOT NULL CHECK (check_key ~ '^[a-z_]{2,60}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  withdrawn_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_period_close_ack_active_uidx
  ON tenant.accounting_period_close_acknowledgements (organization_id, fiscal_period_id, check_key) WHERE withdrawn_at IS NULL;

DO $$
BEGIN
  ALTER TABLE tenant.accounting_period_close_acknowledgements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.accounting_period_close_acknowledgements FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'accounting_period_close_acknowledgements' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.accounting_period_close_acknowledgements
      USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
  GRANT SELECT, INSERT, UPDATE ON tenant.accounting_period_close_acknowledgements TO vercent_app;
  GRANT SELECT ON tenant.accounting_period_close_acknowledgements TO vercent_worker;
END $$;

-- Months already closed or locked by the earlier close runs keep when that happened.
UPDATE tenant.fiscal_periods SET closed_at = COALESCE(locked_at, updated_at) WHERE status IN ('closed', 'locked') AND closed_at IS NULL;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0202_accounting_period_close.sql', 'accounting-period-close') ON CONFLICT DO NOTHING;
