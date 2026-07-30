BEGIN;

ALTER TABLE tenant.accounting_close_runs
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE tenant.accounting_close_tasks
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS depends_on_task_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS waived_at timestamptz,
  ADD COLUMN IF NOT EXISTS waived_by uuid,
  ADD COLUMN IF NOT EXISTS waiver_reason text;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id,company_id,ledger_id,fiscal_period_id
           ORDER BY created_at DESC,id DESC
         ) AS row_number
    FROM tenant.accounting_close_runs
   WHERE status IN ('planned','in_progress','blocked')
)
UPDATE tenant.accounting_close_runs run
   SET status = 'cancelled',
       version = version + 1
  FROM ranked
 WHERE run.id = ranked.id
   AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_close_one_active_run_uidx
  ON tenant.accounting_close_runs(
    organization_id,company_id,ledger_id,fiscal_period_id
  )
  WHERE status IN ('planned','in_progress','blocked');

CREATE INDEX IF NOT EXISTS accounting_close_tasks_dependencies_idx
  ON tenant.accounting_close_tasks
  USING gin(depends_on_task_ids);

COMMIT;
