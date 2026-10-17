-- Projects — Project Status. One lifecycle state machine on the project itself (tenant.projects.status, from 0125): Draft → Planned →
-- In progress ⇄ On hold → Completed, Cancelled from Planned, In progress or On hold, and a controlled Completed → In progress reopening. A Draft
-- that is no longer needed is discarded (removed), never cancelled. Archiving stays a separate state (archived_at).
--
--   1. hold blockers   one active hold episode (tenant.project_holds) holds any number of blockers, each with its reason code, description,
--                      severity, owner, the task or milestone it is about, evidence, and its own resolution. A project resumes only when every
--                      blocker of the episode is resolved, and only to the status the hold interrupted.
--   2. completion      every completion leaves a review: the readiness checks as they stood, the waivers given (what, why, by whom, impact),
--                      the sign-off, notes, customer acceptance and the completion date — bound to the project version it completed. A reopened
--                      project keeps its earlier reviews; the project counts its reopenings.
--   3. transitions     each status change records its reason code and the project version it applied to (beside its reason, actor and key).
--   4. the guard       the database refuses any move outside the state machine, a resume with an open blocker or to another status than the
--                      one interrupted, and a completion without its review.

-- ============================================================ 1. hold blockers
CREATE TABLE IF NOT EXISTS tenant.project_hold_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  hold_id uuid NOT NULL REFERENCES tenant.project_holds(id),
  reason_code text NOT NULL CHECK (reason_code IN ('CUSTOMER_APPROVAL_PENDING', 'RESOURCE_UNAVAILABLE', 'REQUIREMENTS_CHANGE', 'DEPENDENCY_BLOCKED', 'TECHNICAL_ISSUE',
    'BUDGET_REVIEW', 'COMPLIANCE_OR_SAFETY', 'MANAGEMENT_DECISION', 'OTHER')),
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  owner_user_id uuid REFERENCES public.users(id),
  source_type text CHECK (source_type IS NULL OR source_type IN ('TASK', 'MILESTONE')),
  source_id uuid,
  evidence text,
  added_by uuid REFERENCES public.users(id),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution text,
  resolution_evidence text,
  CHECK ((source_type IS NULL) = (source_id IS NULL)),
  CHECK (resolved_at IS NULL OR length(btrim(COALESCE(resolution, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS project_hold_reasons_hold_idx ON tenant.project_hold_reasons (organization_id, hold_id);
CREATE INDEX IF NOT EXISTS project_hold_reasons_open_idx ON tenant.project_hold_reasons (organization_id, project_id) WHERE resolved_at IS NULL;

-- A hold that existed before blockers did becomes one blocker (its reason, its owner), so it resumes the same way as a new one.
INSERT INTO tenant.project_hold_reasons (organization_id, project_id, hold_id, reason_code, description, owner_user_id, added_by, added_at)
SELECT hold.organization_id, hold.project_id, hold.id, 'OTHER', hold.reason, hold.owner_user_id, hold.started_by, hold.started_at
  FROM tenant.project_holds hold
 WHERE hold.resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM tenant.project_hold_reasons reason WHERE reason.hold_id = hold.id);

-- ============================================================ 2. completion reviews and reopenings
CREATE TABLE IF NOT EXISTS tenant.project_completion_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  project_version integer NOT NULL,
  completion_date date NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  waivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  outstanding jsonb NOT NULL DEFAULT '[]'::jsonb,
  closing_note text NOT NULL CHECK (length(btrim(closing_note)) >= 3),
  customer_acceptance text,
  signed_off_by uuid NOT NULL REFERENCES public.users(id),
  signed_off_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_completion_reviews_idx ON tenant.project_completion_reviews (organization_id, project_id, signed_off_at);

ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS last_reopened_at timestamptz;
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS last_reopened_by uuid REFERENCES public.users(id);

-- ============================================================ 3. transitions
ALTER TABLE tenant.project_status_events ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE tenant.project_status_events ADD COLUMN IF NOT EXISTS project_version integer;
CREATE INDEX IF NOT EXISTS project_status_events_recent_idx ON tenant.project_status_events (organization_id, occurred_at DESC);

-- ============================================================ 4. the guard
CREATE OR REPLACE FUNCTION tenant.projects_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A project is never deleted; cancel, archive or (an unused draft) remove it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_code <> OLD.project_code OR NEW.organization_id <> OLD.organization_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'A project keeps its code.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PLANNED')
      OR (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'ON_HOLD', 'CANCELLED'))
      OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('ON_HOLD', 'COMPLETED', 'CANCELLED'))
      OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('PLANNED', 'IN_PROGRESS', 'CANCELLED'))
      OR (OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS')) THEN
      RAISE EXCEPTION 'A project cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    -- A hold resumes to the status it interrupted, once every blocker is resolved.
    IF OLD.status = 'ON_HOLD' AND NEW.status <> 'CANCELLED' THEN
      IF NEW.status IS DISTINCT FROM OLD.previous_status THEN
        RAISE EXCEPTION 'A project resumes to the status its hold interrupted.' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM tenant.project_hold_reasons reason WHERE reason.project_id = OLD.id AND reason.resolved_at IS NULL) THEN
        RAISE EXCEPTION 'Every hold blocker is resolved before the project resumes.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- A completion leaves its review, bound to the version it completed.
    IF NEW.status = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM tenant.project_completion_reviews review WHERE review.project_id = OLD.id AND review.project_version = OLD.row_version) THEN
      RAISE EXCEPTION 'A project is completed through its completion review.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'A removed project stays removed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_completion_reviews_append_only' AND tgrelid = 'tenant.project_completion_reviews'::regclass) THEN
    CREATE TRIGGER project_completion_reviews_append_only BEFORE UPDATE OR DELETE ON tenant.project_completion_reviews FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_hold_reasons_no_delete' AND tgrelid = 'tenant.project_hold_reasons'::regclass) THEN
    CREATE TRIGGER project_hold_reasons_no_delete BEFORE DELETE ON tenant.project_hold_reasons FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
END $$;

-- ============================================================ 5. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_hold_reasons', 'project_completion_reviews'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_hold_reasons TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_completion_reviews TO vercent_app;
GRANT SELECT ON tenant.project_hold_reasons, tenant.project_completion_reviews TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0133_projects_status.sql', 'projects-status') ON CONFLICT DO NOTHING;
