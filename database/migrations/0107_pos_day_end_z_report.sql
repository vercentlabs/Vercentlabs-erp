-- POS Day-End / Z Report: the immutable reporting snapshot of one outlet's business day, built on the closed shifts, cash sessions, cash
-- differences, sales, payments, returns, refunds and GST documents — no second sales aggregation engine, cash ledger or tax calculator, and
-- nothing is reset, deleted or posted by closing a day.
--
--   business day     an outlet's reporting period: its date label, timezone and cut-off (e.g. 04:00 for a store open past midnight), frozen as
--                    a half-open UTC window [start, end) when the day is first used. A cut-off change applies to days not yet created, and each
--                    day starts where the previous one ended, so no sale ever falls between or into two days.
--   lifecycle        OPEN → CLOSING → BLOCKED / READY_TO_FINALIZE → CLOSED (RECOVERY_REQUIRED kept for an uncertain finalization). Selling on
--                    the next day never waits for yesterday's report.
--   Z report         one per business day, stored in the existing day-end report record (so payment reconciliation and accounting posting keep
--                    reading it), now with the frozen snapshot, its hash, the period and the preview hash it was finalized from.
--   exceptions       what stands between the day and its close: blocking (open shifts, unconfirmed cash), approvable (inventory, invoice,
--                    document sequence, finance posting — approved by someone else, for exactly the reviewed figures) and tracked (pending
--                    provider refunds, open cash differences, cash awaiting acceptance).
--   adjustments      what is learned after the close (a late payment confirmation, a refund outcome, a difference resolved) is linked to the
--                    report, never written into it.
--   prints           every print and reprint of a Z report.
--
-- Additive only.

-- ============================================================ 1. the outlet's business-day cut-off
ALTER TABLE tenant.pos_stores ADD COLUMN IF NOT EXISTS business_day_cutoff time NOT NULL DEFAULT '00:00';

-- ============================================================ 2. business days
CREATE TABLE IF NOT EXISTS tenant.pos_business_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  business_date date NOT NULL,
  timezone text NOT NULL,
  cutoff_local_time time NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSING', 'BLOCKED', 'READY_TO_FINALIZE', 'FINALIZING', 'CLOSED', 'RECOVERY_REQUIRED')),
  closing_started_at timestamptz,
  closing_started_by uuid REFERENCES public.users(id),
  last_preview_hash text,
  last_evaluated_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES public.users(id),
  z_report_id uuid REFERENCES tenant.pos_day_end_reports(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND z_report_id IS NOT NULL))
);
-- Closing a day before its scheduled end freezes the reporting cut-off at that moment; the next day starts there.
ALTER TABLE tenant.pos_business_days ADD COLUMN IF NOT EXISTS reporting_cutoff timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS pos_business_days_scope_uidx ON tenant.pos_business_days (organization_id, store_id, business_date);
CREATE INDEX IF NOT EXISTS pos_business_days_status_idx ON tenant.pos_business_days (organization_id, store_id, status);

CREATE OR REPLACE FUNCTION tenant.pos_business_day_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.timezone IS DISTINCT FROM OLD.timezone OR NEW.cutoff_local_time IS DISTINCT FROM OLD.cutoff_local_time THEN
    RAISE EXCEPTION 'A business day''s period cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'CLOSED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.z_report_id IS DISTINCT FROM OLD.z_report_id OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
       OR NEW.reporting_cutoff IS DISTINCT FROM OLD.reporting_cutoff) THEN
    RAISE EXCEPTION 'A closed business day cannot be reopened.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_business_days_guard' AND tgrelid = 'tenant.pos_business_days'::regclass) THEN
    CREATE TRIGGER pos_business_days_guard BEFORE UPDATE ON tenant.pos_business_days FOR EACH ROW EXECUTE FUNCTION tenant.pos_business_day_guard();
  END IF;
END $$;

-- ============================================================ 3. the Z report: the existing day-end report record, now a frozen snapshot
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS business_day_id uuid REFERENCES tenant.pos_business_days(id);
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS report_version integer;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS currency_code text;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS period_start timestamptz;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS period_end timestamptz;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS snapshot jsonb;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS snapshot_hash text;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS preview_hash text;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS source_watermarks jsonb;
ALTER TABLE tenant.pos_day_end_reports ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pos_day_end_reports_business_day_uidx ON tenant.pos_day_end_reports (organization_id, business_day_id) WHERE business_day_id IS NOT NULL AND status <> 'void';
CREATE UNIQUE INDEX IF NOT EXISTS pos_day_end_reports_key_uidx ON tenant.pos_day_end_reports (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_day_end_reports_z_snapshot_check') THEN
    ALTER TABLE tenant.pos_day_end_reports ADD CONSTRAINT pos_day_end_reports_z_snapshot_check
      CHECK (business_day_id IS NULL OR (status = 'closed' AND snapshot IS NOT NULL AND snapshot_hash IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- ============================================================ 4. day-end exceptions
CREATE TABLE IF NOT EXISTS tenant.pos_day_end_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  business_day_id uuid NOT NULL REFERENCES tenant.pos_business_days(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  exception_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('BLOCKING', 'APPROVABLE', 'TRACKED')),
  label text NOT NULL,
  exposure_amount numeric(20, 2),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVAL_REQUESTED', 'APPROVED', 'MANAGED', 'RESOLVED')),
  assigned_to uuid REFERENCES public.users(id),
  owner_reference text,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz,
  request_note text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  approved_preview_hash text,
  resolution_reference text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_preview_hash IS NOT NULL AND severity = 'APPROVABLE')),
  CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_day_end_exceptions_source_uidx ON tenant.pos_day_end_exceptions (organization_id, business_day_id, exception_code, source_id);
CREATE INDEX IF NOT EXISTS pos_day_end_exceptions_open_idx ON tenant.pos_day_end_exceptions (organization_id, business_day_id, status);

-- ============================================================ 5. post-close adjustments (linked, never written into the report)
CREATE TABLE IF NOT EXISTS tenant.pos_z_report_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  z_report_id uuid NOT NULL REFERENCES tenant.pos_day_end_reports(id),
  business_day_id uuid NOT NULL REFERENCES tenant.pos_business_days(id),
  adjustment_category text NOT NULL CHECK (adjustment_category IN ('LATE_PAYMENT_OUTCOME', 'LATE_REFUND_OUTCOME', 'CASH_DIFFERENCE_RESOLVED', 'INVOICE_CORRECTION',
    'INVENTORY_CORRECTION', 'FINANCE_CORRECTION', 'OTHER')),
  source_type text NOT NULL,
  source_id uuid,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  monetary_effect numeric(20, 2),
  description text NOT NULL,
  previous_state text,
  current_state text,
  finance_reference text,
  recorded_by uuid REFERENCES public.users(id),
  automatic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_z_report_adjustments_auto_uidx ON tenant.pos_z_report_adjustments (organization_id, z_report_id, adjustment_category, source_id, current_state)
  WHERE automatic AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_z_report_adjustments_report_idx ON tenant.pos_z_report_adjustments (organization_id, z_report_id, created_at);

CREATE OR REPLACE FUNCTION tenant.pos_z_report_adjustment_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A Z report adjustment is append-only.' USING ERRCODE = 'check_violation';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_z_report_adjustments_append_only' AND tgrelid = 'tenant.pos_z_report_adjustments'::regclass) THEN
    CREATE TRIGGER pos_z_report_adjustments_append_only BEFORE UPDATE OR DELETE ON tenant.pos_z_report_adjustments FOR EACH ROW EXECUTE FUNCTION tenant.pos_z_report_adjustment_append_only();
  END IF;
END $$;

-- ============================================================ 6. prints
CREATE TABLE IF NOT EXISTS tenant.pos_z_report_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  z_report_id uuid NOT NULL REFERENCES tenant.pos_day_end_reports(id),
  format text NOT NULL CHECK (format IN ('THERMAL', 'A4')),
  variant text NOT NULL CHECK (variant IN ('SUMMARY', 'SENSITIVE')),
  is_reprint boolean NOT NULL DEFAULT false,
  reason text,
  printed_by uuid NOT NULL REFERENCES public.users(id),
  printed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_z_report_prints_report_idx ON tenant.pos_z_report_prints (organization_id, z_report_id, printed_at);

-- ============================================================ 7. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_business_days', 'pos_day_end_exceptions', 'pos_z_report_adjustments', 'pos_z_report_prints'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_business_days, tenant.pos_day_end_exceptions TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_z_report_adjustments, tenant.pos_z_report_prints TO vercent_app;
GRANT SELECT ON tenant.pos_business_days, tenant.pos_day_end_exceptions, tenant.pos_z_report_adjustments, tenant.pos_z_report_prints TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0107_pos_day_end_z_report.sql', 'pos-day-end-z-report') ON CONFLICT DO NOTHING;
