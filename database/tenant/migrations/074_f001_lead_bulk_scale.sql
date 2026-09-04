BEGIN;

-- F001 Pass 2C: durable, resumable Lead bulk jobs.
--
-- Large Lead mutations must not be executed as one unbounded HTTP transaction.
-- The generic tenant background queue remains the scheduling authority, while
-- this migration adds requester/result metadata and a per-Lead snapshot table
-- so a bulk job has a stable membership even when the underlying filter changes
-- while the worker is running.

ALTER TABLE tenant.background_jobs
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS result_manifest jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS background_jobs_requester_idx
  ON tenant.background_jobs(organization_id, requested_by, job_type, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_bulk_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES tenant.background_jobs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  expected_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','conflict','skipped','failed')),
  error_code text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_id, lead_id)
);

CREATE INDEX IF NOT EXISTS crm_lead_bulk_job_items_pending_idx
  ON tenant.crm_lead_bulk_job_items(organization_id, job_id, status, lead_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_lead_bulk_job_items_lead_idx
  ON tenant.crm_lead_bulk_job_items(organization_id, lead_id, created_at DESC);

ALTER TABLE tenant.crm_lead_bulk_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_bulk_job_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_lead_bulk_job_items;
CREATE POLICY tenant_organization_isolation ON tenant.crm_lead_bulk_job_items
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

-- Stable queue/list order plus common active-work access paths. The INCLUDE
-- columns keep the high-frequency 50-row Lead queue cheap without creating a
-- combinatorial index for every optional filter.
CREATE INDEX IF NOT EXISTS crm_leads_f001_active_queue_idx
  ON tenant.crm_leads(organization_id, record_status, updated_at DESC, created_at DESC, id DESC)
  INCLUDE (company_id, branch_id, owner_user_id, status, source_id, priority, rating, qualification_state, next_follow_up_at);

CREATE INDEX IF NOT EXISTS crm_leads_f001_owner_queue_idx
  ON tenant.crm_leads(organization_id, owner_user_id, record_status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS crm_leads_f001_followup_queue_idx
  ON tenant.crm_leads(organization_id, record_status, next_follow_up_at, id)
  WHERE next_follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_leads_f001_source_queue_idx
  ON tenant.crm_leads(organization_id, source_id, record_status, updated_at DESC, id DESC)
  WHERE source_id IS NOT NULL;

COMMIT;
