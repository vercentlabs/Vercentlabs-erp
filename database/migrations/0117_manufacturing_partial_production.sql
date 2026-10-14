-- Manufacturing: Partial Production. A manufacturing order makes its output in production batches, each reported by one or more production
-- entries; an entry is a document (draft → reported) whose output then waits for quality, is accepted or rejected, and is received into
-- finished-goods stock in one or more receipts that name the entries they came from — so the same accepted unit is never received twice.
-- Accepted output above the authorized target (the plan, its tolerance and any approved overproduction allowance) needs that allowance;
-- reported output may exceed it (replacements for rejects). A short close is requested and approved by someone else; the plan is never
-- rewritten. A reported entry is corrected by a linked correction, never edited. Additive only: no table, column or constraint is dropped.

-- ============================================================ 1. production batches
CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  batch_reference text NOT NULL CHECK (length(btrim(batch_reference)) > 0),
  production_location_id uuid REFERENCES tenant.warehouse_locations(id),
  planned_quantity numeric(20, 6) CHECK (planned_quantity IS NULL OR planned_quantity > 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  notes text,
  created_by uuid REFERENCES public.users(id),
  closed_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'CLOSED' OR ended_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_batches_reference_uidx ON tenant.manufacturing_production_batches (organization_id, manufacturing_order_id, lower(batch_reference));
CREATE INDEX IF NOT EXISTS manufacturing_production_batches_order_idx ON tenant.manufacturing_production_batches (organization_id, manufacturing_order_id, started_at);

-- Batches recorded before this migration (entries carried a batch reference only) become batches of their orders.
INSERT INTO tenant.manufacturing_production_batches (organization_id, manufacturing_order_id, batch_reference, started_at, created_by)
SELECT DISTINCT ON (entry.organization_id, entry.manufacturing_order_id, lower(entry.batch_reference)) entry.organization_id, entry.manufacturing_order_id, entry.batch_reference, entry.recorded_at, entry.recorded_by
  FROM tenant.manufacturing_production_entries entry
 WHERE entry.batch_reference IS NOT NULL AND btrim(entry.batch_reference) <> ''
 ORDER BY entry.organization_id, entry.manufacturing_order_id, lower(entry.batch_reference), entry.recorded_at
ON CONFLICT DO NOTHING;

-- ============================================================ 2. the production entry as a document
-- Existing entries were posted when written: they are REPORTED. A draft carries its intended split but counts nowhere until posted.
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'REPORTED';
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS production_batch_id uuid REFERENCES tenant.manufacturing_production_batches(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS production_location_id uuid REFERENCES tenant.warehouse_locations(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS entered_quantity numeric(20, 6);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS output_uom_id uuid REFERENCES tenant.units_of_measure(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS conversion_factor numeric(20, 9) NOT NULL DEFAULT 1;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS produced_at timestamptz;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS posting_key text;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS posted_at timestamptz;
-- Downstream figures: received into stock from this entry; corrected (pending output found not to exist; accepted output withdrawn).
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS received_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS corrected_pending_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS corrected_accepted_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS material_override_reason text;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS print_count integer NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS last_printed_at timestamptz;
UPDATE tenant.manufacturing_production_entries SET posted_at = recorded_at, posted_by = recorded_by, produced_at = recorded_at, posting_key = 'legacy:' || id
 WHERE status = 'REPORTED' AND posted_at IS NULL;
UPDATE tenant.manufacturing_production_entries entry SET production_batch_id = batch.id
  FROM tenant.manufacturing_production_batches batch
 WHERE entry.production_batch_id IS NULL AND batch.organization_id = entry.organization_id AND batch.manufacturing_order_id = entry.manufacturing_order_id
   AND lower(batch.batch_reference) = lower(entry.batch_reference);
-- Received before this migration: shared out over the order's entries in the order they were accepted.
WITH accepted AS (
  SELECT entry.id, entry.manufacturing_order_id, entry.recorded_at,
         entry.accepted_quantity + COALESCE((SELECT sum(decision.accepted_quantity) FROM tenant.manufacturing_quality_decisions decision WHERE decision.production_entry_id = entry.id), 0) AS accepted
    FROM tenant.manufacturing_production_entries entry WHERE entry.status = 'REPORTED'),
running AS (
  SELECT accepted.*, sum(accepted.accepted) OVER (PARTITION BY accepted.manufacturing_order_id ORDER BY accepted.recorded_at, accepted.id) - accepted.accepted AS before
    FROM accepted)
UPDATE tenant.manufacturing_production_entries entry SET received_quantity = GREATEST(0, LEAST(running.accepted, mo.received_quantity - running.before))
  FROM running JOIN tenant.manufacturing_orders mo ON mo.id = running.manufacturing_order_id
 WHERE entry.id = running.id AND entry.received_quantity = 0 AND mo.received_quantity > running.before;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_production_entries_status_check') THEN
    ALTER TABLE tenant.manufacturing_production_entries ADD CONSTRAINT manufacturing_production_entries_status_check CHECK (status IN ('DRAFT', 'REPORTED', 'CANCELLED', 'RECOVERY_REQUIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_production_entries_downstream_check') THEN
    ALTER TABLE tenant.manufacturing_production_entries ADD CONSTRAINT manufacturing_production_entries_downstream_check
      CHECK (received_quantity >= 0 AND corrected_pending_quantity >= 0 AND corrected_accepted_quantity >= 0 AND corrected_pending_quantity <= pending_quantity);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_production_entries_posted_check') THEN
    ALTER TABLE tenant.manufacturing_production_entries ADD CONSTRAINT manufacturing_production_entries_posted_check CHECK (status <> 'REPORTED' OR (posted_at IS NOT NULL AND posting_key IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_entries_posting_uidx ON tenant.manufacturing_production_entries (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_production_entries_batch_idx ON tenant.manufacturing_production_entries (organization_id, production_batch_id) WHERE production_batch_id IS NOT NULL;

-- The guard of 0112, extended: a draft may change; a reported entry's quantities are fixed — only what awaits inspection settles (down),
-- and its received and corrected figures grow; its status leaves REPORTED only for recovery.
CREATE OR REPLACE FUNCTION tenant.manufacturing_production_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A production entry is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    IF NEW.status <> 'CANCELLED' OR NEW.reported_quantity <> OLD.reported_quantity THEN
      RAISE EXCEPTION 'A cancelled production entry does not change.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reported_quantity <> OLD.reported_quantity OR NEW.accepted_quantity <> OLD.accepted_quantity OR NEW.rejected_quantity <> OLD.rejected_quantity
      OR NEW.pending_quantity <> OLD.pending_quantity OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.pending_remaining > OLD.pending_remaining
      OR NEW.received_quantity < OLD.received_quantity OR NEW.corrected_pending_quantity < OLD.corrected_pending_quantity
      OR NEW.corrected_accepted_quantity < OLD.corrected_accepted_quantity OR NEW.production_batch_id IS DISTINCT FROM OLD.production_batch_id
      OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR (NEW.status <> OLD.status AND NOT (OLD.status = 'REPORTED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'REPORTED')) THEN
    RAISE EXCEPTION 'A reported production entry does not change; record a quality decision, a receipt or a correction.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================ 3. quality: the disposition of rejected output and its reason code
-- disposition (0112) stays SCRAP or REWORK; QUARANTINE (held for a later decision) is recorded here and kept there as REWORK (not scrapped).
ALTER TABLE tenant.manufacturing_quality_decisions ADD COLUMN IF NOT EXISTS rejection_disposition text;
ALTER TABLE tenant.manufacturing_quality_decisions ADD COLUMN IF NOT EXISTS reason_code text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_quality_decisions_rejection_disposition_check') THEN
    ALTER TABLE tenant.manufacturing_quality_decisions ADD CONSTRAINT manufacturing_quality_decisions_rejection_disposition_check
      CHECK (rejection_disposition IS NULL OR rejection_disposition IN ('QUARANTINE', 'SCRAP', 'REWORK'));
  END IF;
END $$;
UPDATE tenant.manufacturing_quality_decisions SET rejection_disposition = disposition WHERE rejection_disposition IS NULL AND disposition IS NOT NULL;

-- ============================================================ 4. receipts name the entries they received
CREATE TABLE IF NOT EXISTS tenant.manufacturing_goods_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL REFERENCES tenant.manufacturing_goods_receipts(id),
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_goods_receipt_allocations_receipt_idx ON tenant.manufacturing_goods_receipt_allocations (organization_id, goods_receipt_id);
CREATE INDEX IF NOT EXISTS manufacturing_goods_receipt_allocations_entry_idx ON tenant.manufacturing_goods_receipt_allocations (organization_id, production_entry_id);

-- ============================================================ 5. overproduction allowance, short-close request, consumption by batch
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS overproduction_allowance_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS short_close_requested_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS short_close_requested_at timestamptz;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS short_close_request_reason text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_orders_overproduction_allowance_check') THEN
    ALTER TABLE tenant.manufacturing_orders ADD CONSTRAINT manufacturing_orders_overproduction_allowance_check CHECK (overproduction_allowance_quantity >= 0);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS tenant.manufacturing_overproduction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS manufacturing_overproduction_requests_order_idx ON tenant.manufacturing_overproduction_requests (organization_id, manufacturing_order_id, status);
CREATE OR REPLACE FUNCTION tenant.manufacturing_overproduction_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An overproduction request is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'REQUESTED' OR NEW.quantity <> OLD.quantity OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'A decided overproduction request does not change.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE tenant.manufacturing_material_consumptions ADD COLUMN IF NOT EXISTS production_batch_id uuid REFERENCES tenant.manufacturing_production_batches(id);
UPDATE tenant.manufacturing_material_consumptions note SET production_batch_id = entry.production_batch_id
  FROM tenant.manufacturing_production_entries entry WHERE note.production_batch_id IS NULL AND note.production_entry_id = entry.id AND entry.production_batch_id IS NOT NULL;

-- Policy: whether an entry may be posted when the materials for the cumulative output reported are not issued or reserved (WARN shows it;
-- BLOCK refuses it unless someone who may approve variances records why).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_production_material_check text NOT NULL DEFAULT 'WARN';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_settings_production_material_check') THEN
    ALTER TABLE tenant.manufacturing_settings ADD CONSTRAINT manufacturing_settings_production_material_check CHECK (mo_production_material_check IN ('WARN', 'BLOCK'));
  END IF;
END $$;

-- ============================================================ 6. corrections and the entry's timeline
CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number text NOT NULL,
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  kind text NOT NULL CHECK (kind IN ('PENDING', 'ACCEPTED')),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  idempotency_key text NOT NULL,
  corrected_by uuid REFERENCES public.users(id),
  corrected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_corrections_number_uidx ON tenant.manufacturing_production_corrections (organization_id, correction_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_corrections_key_uidx ON tenant.manufacturing_production_corrections (organization_id, idempotency_key);
CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_entry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  action text NOT NULL,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_production_entry_events_entry_idx ON tenant.manufacturing_production_entry_events (organization_id, production_entry_id, occurred_at);

DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_overproduction_requests_guard') THEN
    CREATE TRIGGER manufacturing_overproduction_requests_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_overproduction_requests FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_overproduction_request_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_goods_receipt_allocations', 'manufacturing_production_corrections', 'manufacturing_production_entry_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['manufacturing_production_batches', 'manufacturing_goods_receipt_allocations', 'manufacturing_overproduction_requests', 'manufacturing_production_corrections',
                             'manufacturing_production_entry_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_production_batches, tenant.manufacturing_overproduction_requests TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_goods_receipt_allocations, tenant.manufacturing_production_corrections, tenant.manufacturing_production_entry_events TO vercent_app;
GRANT UPDATE ON tenant.manufacturing_production_entries TO vercent_app;
GRANT SELECT ON tenant.manufacturing_production_batches, tenant.manufacturing_goods_receipt_allocations, tenant.manufacturing_overproduction_requests, tenant.manufacturing_production_corrections,
  tenant.manufacturing_production_entry_events TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.production.edit_draft', 'Prepare production entries', 'Manufacturing', 'Create and edit draft production entries and production batches.'),
  ('manufacturing.production.post', 'Post production entries', 'Manufacturing', 'Confirm output reported by production.'),
  ('manufacturing.production.correct', 'Correct production entries', 'Manufacturing', 'Correct reported output that did not exist (linked correction).'),
  ('manufacturing.production.export', 'Print and export production', 'Manufacturing', 'Print production entries and export production reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.production.edit_draft'), ('manufacturing_manager', 'manufacturing.production.post'), ('manufacturing_manager', 'manufacturing.production.correct'),
    ('manufacturing_manager', 'manufacturing.production.export'),
    ('shop_floor_operator', 'manufacturing.production.edit_draft'), ('shop_floor_operator', 'manufacturing.production.post'),
    ('production_planner', 'manufacturing.production.export'), ('inventory_manager', 'manufacturing.production.export'), ('accountant', 'manufacturing.production.export'),
    ('quality_manager', 'manufacturing.view'), ('quality_manager', 'manufacturing.mo.view'), ('quality_manager', 'manufacturing.mo.quality_decide'), ('quality_manager', 'manufacturing.production.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0117_manufacturing_partial_production.sql', 'manufacturing-partial-production') ON CONFLICT DO NOTHING;
