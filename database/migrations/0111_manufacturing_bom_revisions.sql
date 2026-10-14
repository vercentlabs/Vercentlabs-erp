-- Manufacturing: BOM revision control. Builds on 0110 (BOM masters, revisions, lines, events, snapshots); additive only.
--
--   line lineage       every line carries a lineage id that a copied line keeps, so revisions are compared line by line (two lines of the
--                      same material stay two lines), never by position.
--   effectivity        when an approved revision is used for new production, kept apart from the approved recipe: SCHEDULED (approved,
--                      not yet effective) → ACTIVE → ENDED, or CANCELLED before it starts. Windows are half-open [from, to); two live
--                      windows of one product never overlap, checked under a lock so concurrent activations cannot both pass. The
--                      revision's effective_from / effective_to mirror it for reading.
--   revision changes   the append-only record of each draft edit: line added, removed or modified (by lineage) and header changes, with
--                      the before and after values.
--   idempotency        creating a revision and scheduling one replay the first result for the same request key.

-- ============================================================ 1. line lineage
ALTER TABLE tenant.manufacturing_bom_lines ADD COLUMN IF NOT EXISTS lineage_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_lines_lineage_uidx ON tenant.manufacturing_bom_lines (revision_id, lineage_id);
CREATE INDEX IF NOT EXISTS manufacturing_bom_lines_child_idx ON tenant.manufacturing_bom_lines (organization_id, child_bom_revision_id) WHERE child_bom_revision_id IS NOT NULL;

-- ============================================================ 2. revision request keys
ALTER TABLE tenant.manufacturing_bom_revisions ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_revisions_key_uidx ON tenant.manufacturing_bom_revisions (bom_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 3. effectivity
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_effectivities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_masters(id),
  revision_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_revisions(id),
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  scope_key text NOT NULL DEFAULT 'DEFAULT',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED')),
  -- The window this one cut short when it was scheduled, and where that window ended before, so cancelling restores it.
  replaced_effectivity_id uuid REFERENCES tenant.manufacturing_bom_effectivities(id),
  replaced_previous_to timestamptz,
  idempotency_key text,
  scheduled_by uuid REFERENCES public.users(id),
  scheduled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  ended_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS manufacturing_bom_effectivities_item_idx ON tenant.manufacturing_bom_effectivities (organization_id, finished_item_id, status, effective_from);
CREATE INDEX IF NOT EXISTS manufacturing_bom_effectivities_revision_idx ON tenant.manufacturing_bom_effectivities (organization_id, revision_id);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_effectivities_key_uidx ON tenant.manufacturing_bom_effectivities (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- A revision has at most one live window.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_effectivities_live_uidx ON tenant.manufacturing_bom_effectivities (revision_id) WHERE status IN ('SCHEDULED', 'ACTIVE');

CREATE OR REPLACE FUNCTION tenant.manufacturing_bom_effectivity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A BOM effectivity is kept; cancel or end it instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revision_id <> OLD.revision_id OR NEW.bom_id <> OLD.bom_id OR NEW.finished_item_id <> OLD.finished_item_id OR NEW.scope_key <> OLD.scope_key OR NEW.organization_id <> OLD.organization_id THEN
      RAISE EXCEPTION 'A BOM effectivity keeps its revision and scope.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('ENDED', 'CANCELLED') THEN
      RAISE EXCEPTION 'An ended or cancelled BOM effectivity does not change.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.effective_from <> OLD.effective_from THEN
      RAISE EXCEPTION 'An effective BOM revision keeps its start.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT ((OLD.status = 'SCHEDULED' AND NEW.status IN ('ACTIVE', 'CANCELLED')) OR (OLD.status = 'ACTIVE' AND NEW.status = 'ENDED')) THEN
      RAISE EXCEPTION 'A BOM effectivity cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  ELSE
    IF NOT EXISTS (SELECT 1 FROM tenant.manufacturing_bom_revisions revision WHERE revision.id = NEW.revision_id AND revision.bom_id = NEW.bom_id
                     AND revision.approved_content_hash IS NOT NULL AND (revision.status IN ('APPROVED', 'ACTIVE') OR NEW.status = 'ENDED')) THEN
      RAISE EXCEPTION 'Only an approved BOM revision is scheduled.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Two live windows of one product never overlap (half-open [from, to)); the lock makes concurrent schedules take turns.
  IF NEW.status IN ('SCHEDULED', 'ACTIVE') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('manufacturing_bom_item:' || NEW.finished_item_id::text, 0));
    IF EXISTS (SELECT 1 FROM tenant.manufacturing_bom_effectivities other
                WHERE other.organization_id = NEW.organization_id AND other.finished_item_id = NEW.finished_item_id AND other.scope_key = NEW.scope_key
                  AND other.id <> NEW.id AND other.status IN ('SCHEDULED', 'ACTIVE')
                  AND tstzrange(other.effective_from, other.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')) THEN
      RAISE EXCEPTION 'Another BOM revision is already scheduled for this period.' USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_effectivities_guard' AND tgrelid = 'tenant.manufacturing_bom_effectivities'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_effectivities_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_bom_effectivities FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_effectivity_guard();
  END IF;
END $$;

-- The revision shows its window: the live or last one (cleared when a schedule is cancelled before it starts).
CREATE OR REPLACE FUNCTION tenant.manufacturing_bom_effectivity_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CANCELLED' THEN
    UPDATE tenant.manufacturing_bom_revisions SET effective_from = NULL, effective_to = NULL
     WHERE id = NEW.revision_id AND status = 'APPROVED' AND (effective_from IS NOT NULL OR effective_to IS NOT NULL);
  ELSE
    UPDATE tenant.manufacturing_bom_revisions SET effective_from = NEW.effective_from, effective_to = NEW.effective_to
     WHERE id = NEW.revision_id AND (effective_from IS DISTINCT FROM NEW.effective_from OR effective_to IS DISTINCT FROM NEW.effective_to);
  END IF;
  RETURN NULL;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_effectivities_mirror' AND tgrelid = 'tenant.manufacturing_bom_effectivities'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_effectivities_mirror AFTER INSERT OR UPDATE ON tenant.manufacturing_bom_effectivities FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_effectivity_mirror();
  END IF;
END $$;

-- Windows already recorded on revisions (from 0110) become effectivity records.
INSERT INTO tenant.manufacturing_bom_effectivities (organization_id, bom_id, revision_id, finished_item_id, effective_from, effective_to, status, scheduled_by, scheduled_at, started_at, ended_at)
SELECT revision.organization_id, revision.bom_id, revision.id, master.finished_item_id, revision.effective_from, revision.effective_to,
       CASE WHEN revision.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'ENDED' END, revision.activated_by, COALESCE(revision.activated_at, revision.effective_from), revision.effective_from,
       CASE WHEN revision.status = 'ACTIVE' THEN NULL ELSE COALESCE(revision.effective_to, revision.obsoleted_at, revision.superseded_at) END
  FROM tenant.manufacturing_bom_revisions revision JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id
 WHERE revision.effective_from IS NOT NULL AND revision.status IN ('ACTIVE', 'SUPERSEDED', 'OBSOLETE')
   AND NOT EXISTS (SELECT 1 FROM tenant.manufacturing_bom_effectivities existing WHERE existing.revision_id = revision.id);

-- ============================================================ 4. revision changes (draft edit log)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_revision_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_masters(id),
  -- No foreign key: a discarded draft leaves, its change log stays (like the events).
  revision_id uuid NOT NULL,
  revision_number integer NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('LINE_ADDED', 'LINE_REMOVED', 'LINE_MODIFIED', 'HEADER_MODIFIED', 'CHILD_PINNED')),
  lineage_id uuid,
  item_id uuid REFERENCES tenant.items(id),
  old_value jsonb,
  new_value jsonb,
  reason text,
  changed_by uuid REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_bom_revision_changes_revision_idx ON tenant.manufacturing_bom_revision_changes (organization_id, revision_id, changed_at);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_revision_changes_append_only' AND tgrelid = 'tenant.manufacturing_bom_revision_changes'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_revision_changes_append_only BEFORE UPDATE OR DELETE ON tenant.manufacturing_bom_revision_changes FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only();
  END IF;
END $$;

-- ============================================================ 5. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_bom_effectivities', 'manufacturing_bom_revision_changes'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_bom_effectivities TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_bom_revision_changes TO vercent_app;
GRANT SELECT ON tenant.manufacturing_bom_effectivities, tenant.manufacturing_bom_revision_changes TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0111_manufacturing_bom_revisions.sql', 'manufacturing-bom-revisions') ON CONFLICT DO NOTHING;
