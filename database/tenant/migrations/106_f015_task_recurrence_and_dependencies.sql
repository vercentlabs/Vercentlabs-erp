BEGIN;

-- Prompt 6 (CRM-CAP-004, F015 — Tasks). DEC-CRM-P1-F015 REQUIRED scope
-- (docs/03-modules/crm/features/F015-tasks.md): "recurrence, team/queue
-- tasks, dependencies, generated tasks, overdue derivation, linked-record
-- privacy and idempotent recurrence" — stated with no F013-style scope-
-- narrowing decision anywhere in the migration history. Re-audit found
-- `recurring_rule` (text, migration 002) was pure free text, never parsed
-- by anything — no recurrence engine, no dependency table, and no
-- generated-task provenance field existed anywhere. This closes
-- recurrence, dependencies and provenance; team/queue assignment is a
-- separate, still-open item (see the register).
--
-- recurring_rule (text) is left alone — it remains a human-readable label
-- callers may still set/display. recurrence_config is the NEW, actually-
-- machine-readable field the real engine reads: a small structured JSON
-- shape ({freq, interval, count, until, byWeekday}), not a full RRULE
-- parser — proportionate to "daily/weekly/monthly/interval/weekdays/
-- end-date-count" from the dossier's own worked scope, not "do not build
-- project-management complexity beyond F015 requirements."
ALTER TABLE tenant.crm_activities
  ADD COLUMN IF NOT EXISTS recurrence_config jsonb,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES tenant.crm_activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_source text NOT NULL DEFAULT 'user_created';

ALTER TABLE tenant.crm_activities
  DROP CONSTRAINT IF EXISTS crm_activities_task_source_check;
ALTER TABLE tenant.crm_activities
  ADD CONSTRAINT crm_activities_task_source_check
  CHECK (task_source IN ('user_created', 'lifecycle_generated', 'assignment_generated', 'meeting_generated', 'follow_up_generated', 'recurrence_generated'));

CREATE INDEX IF NOT EXISTS crm_activities_recurrence_parent_idx
  ON tenant.crm_activities(organization_id, recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;

-- Idempotent recurrence generation ledger — the REAL idempotency
-- mechanism is the UNIQUE constraint below, not application-level
-- carefulness: a worker retry, a duplicate tick, or two concurrent
-- workers racing to generate the same next occurrence for the same
-- parent Task all collide on (organization_id, parent_task_id,
-- occurrence_index) and only one row (and one generated Task) survives.
-- "Do not clone thousands of future Task rows at creation" — generation
-- is always exactly one occurrence ahead, driven by completion, not a
-- bulk pre-generation job.
CREATE TABLE IF NOT EXISTS tenant.crm_task_recurrence_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_task_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  occurrence_index integer NOT NULL CHECK (occurrence_index >= 1),
  occurrence_due_at timestamptz NOT NULL,
  generated_task_id uuid REFERENCES tenant.crm_activities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, parent_task_id, occurrence_index)
);

CREATE INDEX IF NOT EXISTS crm_task_recurrence_occurrences_parent_idx
  ON tenant.crm_task_recurrence_occurrences(organization_id, parent_task_id);

-- Task dependencies: task_id cannot be completed while any
-- depends_on_task_id row remains incomplete. Deliberately a flat blocking
-- edge list, not a project-management scheduler — cycle prevention is
-- enforced in the domain function (a recursive-CTE reachability check
-- before insert), the same pattern this codebase already uses for
-- account-hierarchy cycle prevention, not a DB trigger.
CREATE TABLE IF NOT EXISTS tenant.crm_task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (task_id <> depends_on_task_id),
  UNIQUE (organization_id, task_id, depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS crm_task_dependencies_task_idx
  ON tenant.crm_task_dependencies(organization_id, task_id);
CREATE INDEX IF NOT EXISTS crm_task_dependencies_depends_on_idx
  ON tenant.crm_task_dependencies(organization_id, depends_on_task_id);

-- Consistent tenant isolation for both new tables (same convention as
-- migration 071's own RLS loop).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_task_recurrence_occurrences',
    'crm_task_dependencies'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      t
    );
  END LOOP;
END $$;

COMMIT;
