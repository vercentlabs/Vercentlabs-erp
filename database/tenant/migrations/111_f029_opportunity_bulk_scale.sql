BEGIN;

-- F029 (Bulk actions) — LAST PROMPT 1/3 closeout: Opportunities had no
-- async bulk-job path at all. bulkUpdateOpportunities (opportunity-operations.js)
-- is a bounded synchronous path (<=200 records, rejected outright above that
-- cap) that already applies recordScope + value validation + an audit/outbox
-- event (CRM-VNEXT-114, closed in an earlier prompt); this migration adds the
-- durable, resumable job-item table so a large filter-snapshot selection can
-- be queued and processed by a worker in batches, mirroring
-- 074_f001_lead_bulk_scale.sql's crm_lead_bulk_job_items exactly.

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_bulk_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES tenant.background_jobs(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  expected_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','conflict','skipped','failed')),
  error_code text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS crm_opportunity_bulk_job_items_pending_idx
  ON tenant.crm_opportunity_bulk_job_items(organization_id, job_id, status, opportunity_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_opportunity_bulk_job_items_opportunity_idx
  ON tenant.crm_opportunity_bulk_job_items(organization_id, opportunity_id, created_at DESC);

ALTER TABLE tenant.crm_opportunity_bulk_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_bulk_job_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_opportunity_bulk_job_items;
CREATE POLICY tenant_organization_isolation ON tenant.crm_opportunity_bulk_job_items
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

COMMIT;
