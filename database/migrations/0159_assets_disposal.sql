-- Assets — Asset Disposal. A Company-scoped disposal case (one asset, or many) coordinating management approval, the physical exit, the Sales
-- Invoice of a sale and Finance-controlled derecognition, completed per asset. An asset is marked disposed only after its physical exit (or
-- confirmed loss) and, for a capitalized asset, Finance's posted derecognition — exactly once per asset and book. Additive:
--
--   1. cases           the disposal case: type, reason, dates, buyer / recipient / recycler, proposed proceeds, approval state.
--   2. lines           one per asset: snapshots of lifecycle, custody, location; condition; handover evidence; the sale invoice; outcome.
--   3. approvals       each authorization (operational, Finance, management) with the policy and basis it approved (append-only).
--   4. snapshots       the Finance-derived carrying value at the derecognition date for the asset and book (never edited).
--   5. intents         one durable derecognition request per asset and book: command, basis, posting state, Finance's journal.
--   6. events          an append-only history of every disposal step.
--   7. exceptions      the reconciliation queue: what disagrees, who resolves it, how it was resolved.
--   8. guards          one live disposal per asset; a pending disposal restricts ordinary use (availability reads it).
--   9. carry-over      open disposals of the older list continue as cases.
--  10. permissions     view, create, submit, approve, reject, confirm_handover, view_financials, finance_review, request_derecognition,
--                      complete, cancel, correct, bulk, reconcile, export, view_audit.

-- ============================================================ 1. cases
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_number text NOT NULL,
  disposal_type text NOT NULL CHECK (disposal_type IN ('SALE', 'SCRAP', 'DONATION', 'WRITE_OFF_LOST', 'WRITE_OFF_DAMAGED', 'OTHER_APPROVED_EXIT')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'PENDING_HANDOVER', 'PENDING_FINANCE', 'POSTING',
    'COMPLETED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  reason_code text NOT NULL,
  explanation text NOT NULL CHECK (length(btrim(explanation)) >= 5),
  requested_date date NOT NULL DEFAULT current_date,
  proposed_effective_date date NOT NULL,
  buyer_party_id uuid,
  recipient_name text,
  recycler_supplier_id uuid,
  destination text,
  related_party boolean NOT NULL DEFAULT false,
  is_bulk boolean NOT NULL DEFAULT false,
  required_approvals text[] NOT NULL DEFAULT '{}',
  policy_version text,
  basis_hash text,
  approved_at timestamptz,
  submitted_at timestamptz,
  decision_note text,
  cancel_reason text,
  requested_by uuid REFERENCES public.users(id),
  idempotency_key text,
  legacy_disposal_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_disposal_cases_number_key UNIQUE (organization_id, case_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_cases_key_idx ON tenant.asset_disposal_cases (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_disposal_cases_status_idx ON tenant.asset_disposal_cases (organization_id, status);

-- ============================================================ 2. lines
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES tenant.asset_disposal_cases(id),
  line_number integer NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  line_status text NOT NULL DEFAULT 'DRAFT' CHECK (line_status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'PENDING_HANDOVER', 'PENDING_FINANCE', 'POSTING', 'COMPLETED', 'CANCELLED',
    'RECOVERY_REQUIRED', 'REINSTATED')),
  lifecycle_snapshot text NOT NULL,
  capitalization_snapshot text,
  custody_snapshot_id uuid,
  custodian_label text,
  location_snapshot_id uuid,
  location_label text,
  missing_incident_id uuid,
  condition_at_disposal text CHECK (condition_at_disposal IS NULL OR condition_at_disposal IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  proposed_proceeds numeric(18,2) NOT NULL DEFAULT 0 CHECK (proposed_proceeds >= 0),
  disposal_costs numeric(18,2) NOT NULL DEFAULT 0 CHECK (disposal_costs >= 0),
  custody_exception_reason text,
  custody_exception_by uuid REFERENCES public.users(id),
  handover_kind text CHECK (handover_kind IS NULL OR handover_kind IN ('BUYER_DELIVERY', 'RECYCLER_RECEIPT', 'DONATION_RECEIPT', 'DESTRUCTION', 'OTHER_EXIT', 'LOSS_EVIDENCE')),
  handover_recipient text,
  handover_reference text,
  handover_evidence text,
  handover_at timestamptz,
  handover_by uuid REFERENCES public.users(id),
  transfer_id uuid,
  actual_disposition_date date,
  sale_invoice_id uuid,
  sale_invoice_number text,
  sale_proceeds numeric(18,2) CHECK (sale_proceeds IS NULL OR sale_proceeds >= 0),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id),
  reinstated_at timestamptz,
  reinstated_by uuid REFERENCES public.users(id),
  reinstatement_reason text,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_disposal_lines_key UNIQUE (case_id, line_number),
  CONSTRAINT asset_disposal_lines_completion_check CHECK ((line_status IN ('COMPLETED', 'REINSTATED')) = (completed_at IS NOT NULL))
);
-- One live disposal per asset: a second, conflicting request is refused.
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_lines_live_idx ON tenant.asset_disposal_lines (asset_id)
  WHERE line_status NOT IN ('REJECTED', 'CANCELLED', 'COMPLETED', 'REINSTATED');
CREATE INDEX IF NOT EXISTS asset_disposal_lines_case_idx ON tenant.asset_disposal_lines (case_id);

-- ============================================================ 3. approvals
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES tenant.asset_disposal_cases(id),
  level text NOT NULL CHECK (level IN ('OPERATIONAL', 'FINANCE', 'MANAGEMENT')),
  approver_user_id uuid NOT NULL REFERENCES public.users(id),
  policy_version text NOT NULL,
  basis_hash text NOT NULL,
  note text,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_disposal_approvals_case_idx ON tenant.asset_disposal_approvals (case_id);

-- ============================================================ 4. financial snapshots
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_id uuid NOT NULL REFERENCES tenant.asset_disposal_lines(id),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  book text NOT NULL DEFAULT 'FINANCIAL_REPORTING',
  effective_date date NOT NULL,
  capitalized_cost numeric(18,2) NOT NULL,
  accumulated_depreciation numeric(18,2) NOT NULL,
  impairment numeric(18,2) NOT NULL DEFAULT 0,
  carrying_amount numeric(18,2) NOT NULL,
  net_proceeds numeric(18,2) NOT NULL DEFAULT 0,
  disposal_costs numeric(18,2) NOT NULL DEFAULT 0,
  gain_loss numeric(18,2) NOT NULL,
  asset_account_id uuid,
  accumulated_account_id uuid,
  proceeds_account_id uuid,
  gain_loss_account_id uuid,
  basis_hash text NOT NULL,
  confirmed_by uuid REFERENCES public.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_disposal_financial_snapshots_append_only') THEN
    CREATE TRIGGER asset_disposal_financial_snapshots_append_only BEFORE UPDATE OR DELETE ON tenant.asset_disposal_financial_snapshots FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 5. accounting intents
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_accounting_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_id uuid NOT NULL REFERENCES tenant.asset_disposal_lines(id),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  book text NOT NULL DEFAULT 'FINANCIAL_REPORTING',
  snapshot_id uuid REFERENCES tenant.asset_disposal_financial_snapshots(id),
  command_id text NOT NULL,
  basis_hash text NOT NULL,
  posting_date date NOT NULL,
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'POSTING', 'POSTED', 'NOT_REQUIRED', 'RECOVERY_REQUIRED', 'WITHDRAWN', 'REVERSED')),
  journal_entry_id uuid,
  reversal_journal_entry_id uuid,
  result text,
  prepared_by uuid REFERENCES public.users(id),
  posted_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_disposal_intents_command_key UNIQUE (organization_id, command_id),
  CONSTRAINT asset_disposal_intents_journal_check CHECK (status NOT IN ('POSTED', 'REVERSED') OR journal_entry_id IS NOT NULL)
);
-- The asset's balance in a book is derecognized exactly once for a disposal: one live intent per asset and book.
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_intents_live_idx ON tenant.asset_disposal_accounting_intents (asset_id, book)
  WHERE status IN ('PREPARED', 'POSTING', 'POSTED', 'NOT_REQUIRED', 'RECOVERY_REQUIRED');
CREATE INDEX IF NOT EXISTS asset_disposal_intents_line_idx ON tenant.asset_disposal_accounting_intents (line_id);
-- A posted derecognition is never deleted or rewritten; it is only reversed by Finance.
CREATE OR REPLACE FUNCTION tenant.asset_disposal_intents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A derecognition intent is withdrawn or reversed, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('POSTED', 'NOT_REQUIRED') AND NEW.status NOT IN ('POSTED', 'NOT_REQUIRED', 'REVERSED') THEN
    RAISE EXCEPTION 'A posted derecognition is reversed by Finance, never reopened.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('REVERSED', 'WITHDRAWN') THEN RAISE EXCEPTION 'A reversed or withdrawn intent stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN RAISE EXCEPTION 'The posted journal is kept.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.line_id <> OLD.line_id OR NEW.book <> OLD.book OR NEW.command_id <> OLD.command_id THEN
    RAISE EXCEPTION 'An intent keeps its asset, line, book and command.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_disposal_intents_guard') THEN
    CREATE TRIGGER asset_disposal_intents_guard BEFORE UPDATE OR DELETE ON tenant.asset_disposal_accounting_intents FOR EACH ROW EXECUTE FUNCTION tenant.asset_disposal_intents_guard();
  END IF;
END $$;

-- ============================================================ 6. events
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid REFERENCES tenant.asset_disposal_cases(id),
  line_id uuid REFERENCES tenant.asset_disposal_lines(id),
  asset_id uuid REFERENCES tenant.assets(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  command_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_disposal_events_case_idx ON tenant.asset_disposal_events (case_id, occurred_at);
CREATE INDEX IF NOT EXISTS asset_disposal_events_asset_idx ON tenant.asset_disposal_events (asset_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_events_command_idx ON tenant.asset_disposal_events (organization_id, command_id) WHERE command_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_disposal_events_append_only') THEN
    CREATE TRIGGER asset_disposal_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_disposal_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_disposal_approvals_append_only') THEN
    CREATE TRIGGER asset_disposal_approvals_append_only BEFORE UPDATE OR DELETE ON tenant.asset_disposal_approvals FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 7. exceptions
CREATE TABLE IF NOT EXISTS tenant.asset_disposal_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES tenant.asset_disposal_cases(id),
  line_id uuid REFERENCES tenant.asset_disposal_lines(id),
  asset_id uuid REFERENCES tenant.assets(id),
  code text NOT NULL,
  detail text,
  source_document text,
  responsible text NOT NULL DEFAULT 'ASSETS' CHECK (responsible IN ('ASSETS', 'FINANCE', 'SALES')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_disposal_exceptions_resolution_check CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_disposal_exceptions_open_idx ON tenant.asset_disposal_exceptions (case_id, COALESCE(line_id, case_id), code) WHERE status = 'OPEN';

-- ============================================================ 8. pending-disposal guard and availability
-- The disposal case an asset is committed to (approved and not yet completed), or null.
CREATE OR REPLACE FUNCTION tenant.asset_disposal_pending(asset uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT c.case_number FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases c ON c.id = l.case_id
  WHERE l.asset_id = asset AND l.line_status IN ('PENDING_HANDOVER', 'PENDING_FINANCE', 'POSTING', 'RECOVERY_REQUIRED') LIMIT 1
$$;
-- Effective availability: a pending disposal takes the asset out of ordinary use (it may still move to its buyer or recycler); the lifecycle
-- changes to Disposed only when the disposal completes.
CREATE OR REPLACE FUNCTION tenant.asset_effective_availability(a tenant.assets) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.lifecycle_status <> 'ACTIVE' THEN 'NOT_AVAILABLE'
    WHEN a.availability_status = 'MAINTENANCE'
      OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_orders m WHERE m.asset_id = a.id AND m.status = 'in_progress' AND m.took_asset_out_of_service IS NOT FALSE)
      OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_restrictions r WHERE r.asset_id = a.id AND r.status = 'ACTIVE' AND r.restriction_type IN ('SAFETY', 'UNDER_MAINTENANCE')) THEN 'UNDER_MAINTENANCE'
    WHEN EXISTS (SELECT 1 FROM tenant.asset_transfer_lines t WHERE t.asset_id = a.id AND t.line_status IN ('DISPATCHED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')) THEN 'IN_TRANSFER'
    WHEN tenant.asset_disposal_pending(a.id) IS NOT NULL THEN 'NOT_AVAILABLE'
    WHEN a.current_user_id IS NOT NULL OR a.current_department_id IS NOT NULL OR a.availability_status = 'ASSIGNED' THEN 'ASSIGNED'
    WHEN a.availability_status = 'RESTRICTED' OR a.condition = 'UNSERVICEABLE' THEN 'NOT_AVAILABLE'
    ELSE 'AVAILABLE' END
$$;

-- ============================================================ settings
-- Capitalized assets, donations, write-offs and anything with proceeds need Finance's approval; at or above the management threshold (total
-- carrying value), and for a donation or a related-party sale, a second (management) approver too.
ALTER TABLE tenant.asset_settings
  ADD COLUMN IF NOT EXISTS disposal_management_threshold numeric(18,2) NOT NULL DEFAULT 100000 CHECK (disposal_management_threshold >= 0);

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_disposal_cases', 'asset_disposal_lines', 'asset_disposal_approvals', 'asset_disposal_financial_snapshots', 'asset_disposal_accounting_intents',
    'asset_disposal_events', 'asset_disposal_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_disposal_cases, tenant.asset_disposal_lines, tenant.asset_disposal_accounting_intents, tenant.asset_disposal_exceptions TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.asset_disposal_approvals, tenant.asset_disposal_financial_snapshots, tenant.asset_disposal_events TO vercent_app, vercent_worker;

-- ============================================================ 9. carry-over of the older disposal list
-- An open older disposal (waiting for approval, or approved) continues as a case; the older row is closed with a pointer and the asset's
-- older 'pending disposal' status returns to what it was (the case now restricts it). Completed older disposals stay as history.
DO $$
DECLARE
  d record;
  case_id uuid;
  n integer;
BEGIN
  FOR d IN SELECT x.*, a.lifecycle_status, a.capitalization_class, a.location_id FROM tenant.asset_disposals x JOIN tenant.assets a ON a.id = x.asset_id
      WHERE x.status IN ('pending_approval', 'approved') AND NOT EXISTS (SELECT 1 FROM tenant.asset_disposal_cases c WHERE c.legacy_disposal_id = x.id) LOOP
    n := (SELECT count(*) + 1 FROM tenant.asset_disposal_cases c WHERE c.organization_id = d.organization_id);
    UPDATE tenant.assets SET status = COALESCE(NULLIF(d.previous_status, 'pending_disposal'), 'retired') WHERE id = d.asset_id AND status = 'pending_disposal';
    INSERT INTO tenant.asset_disposal_cases (organization_id, case_number, disposal_type, status, reason_code, explanation, requested_date, proposed_effective_date, buyer_party_id, required_approvals,
        approved_at, submitted_at, requested_by, legacy_disposal_id, created_at)
      VALUES (d.organization_id, 'ADP-C' || lpad(n::text, 5, '0'),
        CASE d.disposal_method WHEN 'sale' THEN 'SALE' WHEN 'scrap' THEN 'SCRAP' WHEN 'donation' THEN 'DONATION' WHEN 'write_off' THEN 'WRITE_OFF_DAMAGED' ELSE 'OTHER_APPROVED_EXIT' END,
        CASE d.status WHEN 'approved' THEN 'PENDING_HANDOVER' ELSE 'PENDING_APPROVAL' END, 'CARRIED_OVER',
        CASE WHEN length(btrim(d.reason)) >= 5 THEN d.reason ELSE 'Carried over: ' || d.reason END, d.created_at::date, d.disposal_date, d.buyer_party_id,
        CASE WHEN d.status = 'approved' THEN '{}'::text[] ELSE ARRAY['OPERATIONAL'] END, d.approved_at, d.created_at, d.requested_by, d.id, d.created_at)
      RETURNING id INTO case_id;
    INSERT INTO tenant.asset_disposal_lines (organization_id, case_id, line_number, asset_id, line_status, lifecycle_snapshot, capitalization_snapshot, location_snapshot_id, proposed_proceeds, disposal_costs)
      VALUES (d.organization_id, case_id, 1, d.asset_id, CASE d.status WHEN 'approved' THEN 'PENDING_HANDOVER' ELSE 'PENDING_APPROVAL' END,
        (SELECT lifecycle_status FROM tenant.assets WHERE id = d.asset_id), d.capitalization_class, d.location_id, round(d.proceeds_amount, 2), round(d.disposal_cost, 2));
    INSERT INTO tenant.asset_disposal_events (organization_id, case_id, asset_id, action, details) VALUES (d.organization_id, case_id, d.asset_id, 'CARRIED_OVER', jsonb_build_object('legacyDisposal', d.disposal_number));
    UPDATE tenant.asset_disposals SET status = 'cancelled', rejected_reason = 'Carried over to the new disposal workflow' WHERE id = d.id;
  END LOOP;
END $$;

-- ============================================================ 10. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.disposal.view', 'View asset disposals', 'Assets', 'See disposal cases.'),
  ('assets.disposal.create', 'Prepare asset disposals', 'Assets', 'Create and edit disposal requests.'),
  ('assets.disposal.submit', 'Submit asset disposals', 'Assets', 'Send a disposal request for approval.'),
  ('assets.disposal.approve', 'Approve asset disposals', 'Assets', 'Authorize a disposal (operational or management approval).'),
  ('assets.disposal.reject', 'Reject asset disposals', 'Assets', 'Reject a disposal or ask for changes.'),
  ('assets.disposal.confirm_handover', 'Confirm disposal handovers', 'Assets', 'Record the physical exit of a disposed asset.'),
  ('assets.disposal.view_financials', 'View disposal financials', 'Assets', 'See cost, carrying value, proceeds and gain or loss.'),
  ('assets.disposal.finance_review', 'Review disposal accounting', 'Assets', 'Approve the financial treatment of a disposal.'),
  ('assets.disposal.request_derecognition', 'Request asset derecognition', 'Assets', 'Prepare and submit the derecognition to Finance.'),
  ('assets.disposal.complete', 'Complete asset disposals', 'Assets', 'Finalize a validated disposal.'),
  ('assets.disposal.cancel', 'Cancel asset disposals', 'Assets', 'Cancel a disposal before its physical exit.'),
  ('assets.disposal.correct', 'Correct asset disposals', 'Assets', 'Reverse a completed disposal and reinstate the asset.'),
  ('assets.disposal.bulk', 'Bulk asset disposals', 'Assets', 'Dispose of several assets in one case.'),
  ('assets.disposal.reconcile', 'Reconcile asset disposals', 'Assets', 'Run the disposal reconciliation and resolve exceptions.'),
  ('assets.disposal.export', 'Export asset disposals', 'Assets', 'Download disposal records and reports.'),
  ('assets.disposal.view_audit', 'View disposal history', 'Assets', 'See every disposal event.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.disposal.view'), ('asset_manager', 'assets.disposal.create'), ('asset_manager', 'assets.disposal.submit'), ('asset_manager', 'assets.disposal.approve'),
    ('asset_manager', 'assets.disposal.reject'), ('asset_manager', 'assets.disposal.confirm_handover'), ('asset_manager', 'assets.disposal.view_financials'), ('asset_manager', 'assets.disposal.complete'),
    ('asset_manager', 'assets.disposal.cancel'), ('asset_manager', 'assets.disposal.bulk'), ('asset_manager', 'assets.disposal.reconcile'), ('asset_manager', 'assets.disposal.export'),
    ('asset_manager', 'assets.disposal.view_audit'),
    ('finance_manager', 'assets.disposal.view'), ('finance_manager', 'assets.disposal.approve'), ('finance_manager', 'assets.disposal.reject'), ('finance_manager', 'assets.disposal.view_financials'),
    ('finance_manager', 'assets.disposal.finance_review'), ('finance_manager', 'assets.disposal.request_derecognition'), ('finance_manager', 'assets.disposal.complete'),
    ('finance_manager', 'assets.disposal.correct'), ('finance_manager', 'assets.disposal.reconcile'), ('finance_manager', 'assets.disposal.export'), ('finance_manager', 'assets.disposal.view_audit'),
    ('accountant', 'assets.disposal.view'), ('accountant', 'assets.disposal.view_financials'), ('accountant', 'assets.disposal.finance_review'), ('accountant', 'assets.disposal.request_derecognition'),
    ('accountant', 'assets.disposal.reconcile'),
    ('inventory_manager', 'assets.disposal.view'), ('inventory_manager', 'assets.disposal.confirm_handover'),
    ('auditor', 'assets.disposal.view'), ('auditor', 'assets.disposal.view_financials'), ('auditor', 'assets.disposal.export'), ('auditor', 'assets.disposal.view_audit')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0159_assets_disposal.sql', 'assets-disposal') ON CONFLICT DO NOTHING;
