BEGIN;

-- Prompt 13 (Background Worker & Scheduler Foundation).
--
-- Generic durable job queue for tenant-scoped background work. Lives in
-- the tenant schema (not control-plane) because every existing
-- background-work structure found during this prompt's audit
-- (tenant.crm_automation_rules/runs, tenant.crm_outbox_events,
-- tenant.crm_webhook_subscriptions) is already tenant-scoped, RLS-enforced
-- business data — a cross-tenant queue table would risk exactly the
-- "global business payload queue that can accidentally execute against
-- the wrong tenant" this prompt's own instructions warn against.
--
-- tenant.crm_outbox_events (002_crm_module.sql, extended by
-- 004_enterprise_tenant_integrity.sql and 007_crm_outbox_leases.sql) is
-- NOT migrated into this table — it already has its own complete,
-- purpose-built lease/retry/dead-letter shape (locked_by, locked_at,
-- status incl. 'dead_letter', attempt_count, next_attempt_at, last_error,
-- delivery_receipt) and is reused as-is by the new worker for webhook
-- delivery specifically (see services/worker/src/outbox.js). This table
-- is for everything else: today, only the activity.overdue scheduled
-- detection tick (services/worker/src/handlers/crm-automation-overdue.js).
--
-- Status model deliberately has 4 states, not the 6 conceptually listed
-- in this prompt's own spec: a "failed-but-still-retryable" job is
-- represented as 'pending' again (with a future run_at and last_error
-- populated) rather than a separate 'failed' state, since the two are
-- behaviorally identical; 'cancelled' was dropped because this prompt
-- builds no cancellation capability anywhere — a status value nothing can
-- ever set is exactly the "excessive workflow state" this prompt's own
-- instructions say to avoid. Both can be added later as a real, additive
-- migration the day a real cancellation feature needs them.

CREATE TABLE IF NOT EXISTS tenant.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'dead')),
  run_at timestamptz NOT NULL DEFAULT now(),
  priority integer NOT NULL DEFAULT 100,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

-- Covers the two "claimable" branches of the worker's claim query: a
-- pending job whose run_at has arrived, or a processing job whose lease
-- has expired (a crashed/killed worker's job becoming reclaimable).
CREATE INDEX IF NOT EXISTS background_jobs_pending_idx
  ON tenant.background_jobs(organization_id, status, run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS background_jobs_lease_idx
  ON tenant.background_jobs(organization_id, status, lease_expires_at)
  WHERE status = 'processing';

ALTER TABLE tenant.background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.background_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.background_jobs;
CREATE POLICY tenant_organization_isolation ON tenant.background_jobs
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

COMMIT;
