BEGIN;

-- Workflow engine and shared reporting (Prompt 5), on the existing
-- workflow_definitions / workflow_runs / report_definitions / report_runs.

-- Workflows: a definition carries its trigger and a version. Every saved
-- change is also kept in workflow_definition_versions, and each run records
-- the version it evaluated, so later edits never change what a past run meant.
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS trigger_event text;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE workflow_definitions SET trigger_event = NULLIF(definition->>'trigger', '') WHERE trigger_event IS NULL;
CREATE INDEX IF NOT EXISTS workflow_definitions_trigger_idx ON workflow_definitions (organization_id, trigger_event) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS workflow_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);
-- Existing definitions become their own version 1.
INSERT INTO workflow_definition_versions (organization_id, workflow_id, version, definition, created_by, created_at)
SELECT organization_id, id, version, definition, created_by, created_at FROM workflow_definitions
ON CONFLICT (workflow_id, version) DO NOTHING;

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_version integer;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS workflow_runs_due_idx ON workflow_runs (organization_id, created_at) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs (organization_id, workflow_id, created_at DESC);

-- Reports: a run's output is a Shared Platform file (artifact id), never a
-- module URL; the run keeps the columns it produced for evidence.
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS output_file_id uuid REFERENCES attachments(id) ON DELETE SET NULL;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS columns jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS job_id uuid;
CREATE INDEX IF NOT EXISTS report_runs_org_idx ON report_runs (organization_id, requested_at DESC);
-- Older rows pointed output_reference at a module screen URL; that was never
-- an artifact. Keep the text for history, but it is no longer an output.
COMMENT ON COLUMN report_runs.output_reference IS 'Legacy (pre Prompt 5): a module screen URL, not an artifact. New runs use output_file_id.';

COMMIT;
