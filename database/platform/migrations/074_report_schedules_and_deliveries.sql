BEGIN;

-- Scheduled delivery for saved reports (CRM F030 and any other dataset).
-- A schedule belongs to a saved definition. At each occurrence every
-- recipient gets their OWN run, executed with that recipient's current
-- authority (never the schedule owner's), so a scheduled report can never
-- deliver rows a recipient could not open themselves. Each (run, recipient)
-- delivery is recorded once.

CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_definition_id uuid NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  time_of_day text NOT NULL CHECK (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekday smallint CHECK (weekday BETWEEN 0 AND 6),
  month_day smallint CHECK (month_day BETWEEN 1 AND 28),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
  recipients uuid[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 25),
  company_id uuid,
  branch_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (frequency <> 'weekly' OR weekday IS NOT NULL),
  CHECK (frequency <> 'monthly' OR month_day IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON report_schedules(organization_id, next_run_at) WHERE status = 'active';

ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES report_schedules(id) ON DELETE SET NULL;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS occurrence_at timestamptz;

CREATE TABLE IF NOT EXISTS report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
  occurrence_at timestamptz NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_run_id uuid REFERENCES report_runs(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued', 'delivered', 'skipped', 'failed')),
  reason text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, occurrence_at, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS report_deliveries_schedule_idx ON report_deliveries(organization_id, schedule_id, occurrence_at DESC);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.report_schedules;
CREATE POLICY organization_isolation ON public.report_schedules USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.report_deliveries;
CREATE POLICY organization_isolation ON public.report_deliveries USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());

COMMIT;
