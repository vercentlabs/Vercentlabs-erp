BEGIN;

-- F005 gap 1/2: resolveLeadAssignment returned {ownerUserId: null,
-- reason: "unassigned"} whenever no active policy produced an owner, with
-- no defined fallback queue/manager to route to instead. A single
-- per-organization fallback owner (not a new policy mode) is the correct
-- shape: it is checked once, last, after every real policy has already
-- had its chance — never a substitute for actually configuring policies.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_assignment_fallback (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  fallback_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant.crm_lead_assignment_fallback ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_fallback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_lead_assignment_fallback;
CREATE POLICY tenant_organization_isolation ON tenant.crm_lead_assignment_fallback
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

-- F005 gap 2/2: no out-of-office/availability signal existed anywhere, so
-- an eligible-but-currently-away user could still be selected by
-- round-robin/workload/territory/fixed automatic assignment. A simple
-- date-range table, independent of the HR & Payroll module's
-- hr_leave_requests (which keys off hr_employees, not users, and is not
-- guaranteed to be populated for every organization) — this is a CRM
-- assignment-routing concern, not a leave-management one.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_assignee_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS crm_lead_assignee_availability_window_idx
  ON tenant.crm_lead_assignee_availability(organization_id, user_id, starts_at, ends_at);

ALTER TABLE tenant.crm_lead_assignee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignee_availability FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_lead_assignee_availability;
CREATE POLICY tenant_organization_isolation ON tenant.crm_lead_assignee_availability
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

COMMIT;
