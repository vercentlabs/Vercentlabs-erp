-- CRM plan, steps 3.5 and 3.6: nobody leaves a lead untouched unnoticed, overdue work reaches the manager, unassigned leads are
-- routed again on their own, and automatic assignment respects how much each salesperson can take and who is away.
--
-- 1. Lead assignment settings gain: first_response_hours (a new lead nobody has called, mailed or met by then — its owner is told),
--    response_escalation_hours (still untouched by then — the team manager is told), overdue_escalation_hours (a task or follow-up
--    still overdue that long after its due time — the assignee's manager is told), rerun_unassigned_hours (unassigned open leads are
--    put through the assignment rules again every so often). Each is off when empty.
-- 2. A lead keeps when its owner was alerted and when the manager was; an activity keeps when its overdue was escalated, and whether it
--    records something the customer did (an inbound email, a repeat enquiry) rather than our response to them.
-- 3. tenant.crm_salesperson_availability: a salesperson's monthly lead capacity (leads assigned in the last 30 days, as Odoo counts)
--    and a pause (from and until a date, with a reason). Automatic assignment — rules, round robin, the fallback owner — passes over
--    someone paused or full; assigning by hand still works, with a warning.
ALTER TABLE tenant.crm_lead_assignment_settings
  ADD COLUMN IF NOT EXISTS first_response_hours integer CHECK (first_response_hours IS NULL OR first_response_hours BETWEEN 1 AND 720),
  ADD COLUMN IF NOT EXISTS response_escalation_hours integer CHECK (response_escalation_hours IS NULL OR response_escalation_hours BETWEEN 1 AND 720),
  ADD COLUMN IF NOT EXISTS overdue_escalation_hours integer CHECK (overdue_escalation_hours IS NULL OR overdue_escalation_hours BETWEEN 1 AND 720),
  ADD COLUMN IF NOT EXISTS rerun_unassigned_hours integer CHECK (rerun_unassigned_hours IS NULL OR rerun_unassigned_hours BETWEEN 1 AND 168),
  ADD COLUMN IF NOT EXISTS last_rerun_at timestamptz;

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS response_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_escalated_at timestamptz;
ALTER TABLE tenant.crm_activities
  ADD COLUMN IF NOT EXISTS is_inbound boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overdue_escalated_at timestamptz;
-- What came in by email or as a repeat enquiry is the customer's doing, not a response.
UPDATE tenant.crm_activities SET is_inbound = true WHERE activity_type = 'email' AND status = 'completed' AND external_id IS NOT NULL AND NOT is_inbound;
UPDATE tenant.crm_activities SET is_inbound = true WHERE activity_type = 'other' AND status = 'completed' AND subject LIKE '%enquiry from %' AND NOT is_inbound;

CREATE TABLE IF NOT EXISTS tenant.crm_salesperson_availability (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  monthly_lead_capacity integer CHECK (monthly_lead_capacity IS NULL OR monthly_lead_capacity BETWEEN 0 AND 100000),
  paused_from date,
  paused_until date,
  pause_reason text CHECK (pause_reason IS NULL OR char_length(pause_reason) <= 200),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT crm_salesperson_availability_pause_check CHECK (paused_from IS NULL OR paused_until IS NULL OR paused_from <= paused_until)
);
ALTER TABLE tenant.crm_salesperson_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_salesperson_availability FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_salesperson_availability' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_salesperson_availability USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_salesperson_availability TO vercent_app, vercent_worker;

CREATE INDEX IF NOT EXISTS crm_leads_awaiting_response_idx ON tenant.crm_leads (organization_id, created_at)
  WHERE status IN ('open', 'qualified') AND archived_at IS NULL AND response_escalated_at IS NULL;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0170_crm_response_capacity.sql', 'crm-response-capacity') ON CONFLICT DO NOTHING;
