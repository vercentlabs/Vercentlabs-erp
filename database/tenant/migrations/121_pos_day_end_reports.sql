BEGIN;

-- F303: Day-end / Z report. First of a three-feature chain (F303 -> F304
-- payment reconciliation -> F305 accounting posting) — this schema and its
-- domain functions (services/api/src/modules/point-of-sale/features/
-- day-end-reports.js) are a stable contract another, later workstream reads
-- from without being able to ask questions, so field names/shapes here are
-- deliberately explicit and typed rather than folded into a single opaque
-- JSON blob wherever a real column would do.
--
-- Scope model: a report is either scope_type='shift' (exactly one closed
-- shift) or scope_type='business_day' (every shift closed on a given
-- store-timezone business date, either for one terminal or, when
-- terminal_id IS NULL, for every terminal in the store). Both are
-- "Z reports" in the retail sense; a per-shift Z is the common case, a
-- per-business-day Z is the end-of-day roll-up a store manager reconciles
-- against. Only CLOSED shifts and COMPLETED sales/returns ever contribute —
-- a still-open shift or an in-flight (draft/voided) transaction is simply
-- excluded from the aggregation, never blocked-and-retried; see
-- day-end-reports.js's resolveScope() for exactly which WHERE clauses
-- enforce this.
CREATE TABLE IF NOT EXISTS tenant.pos_day_end_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  -- NULL only for scope_type='business_day' (a store-wide roll-up across
  -- every terminal). Always populated for scope_type='shift'.
  terminal_id uuid REFERENCES tenant.pos_terminals(id),
  scope_type text NOT NULL CHECK (scope_type IN ('shift','business_day')),
  -- Required and unique-scoped when scope_type='shift'; always NULL for
  -- scope_type='business_day' (which can aggregate many shifts).
  shift_id uuid REFERENCES tenant.pos_shifts(id),
  -- The calendar date, in tenant.pos_stores.timezone, this report covers.
  -- For scope_type='shift' this is derived once from the shift's own
  -- closed_at (closed_at AT TIME ZONE store.timezone)::date and frozen here
  -- — never recomputed from "now" on a later read/regenerate.
  business_date date NOT NULL,

  -- STATE MACHINE (see the F303 module docstring in day-end-reports.js for
  -- the full transition table): draft (computed totals, still mutable and
  -- re-computable) -> reviewed (a supervisor-tier signoff) -> closed
  -- (finalized by a DIFFERENT authority, immutable from here on) -> void
  -- (reserved for a future cancellation path; not produced by any function
  -- in this pass, included in the CHECK/indexes now so it never requires a
  -- later migration to introduce). "draft" already means "computed" — there
  -- is no separate empty/uncalculated placeholder row: generatePosDayEndReport
  -- computes every total synchronously in the same transaction that creates
  -- or refreshes the draft row, because the source data is fully available
  -- and deterministic at generation time; deferring the computation to a
  -- later step would add state without adding meaning.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','closed','void')),

  report_number text NOT NULL,

  -- ---- Reconciled sales figures (all tax-scale numeric(20,6), computed
  -- from tenant.pos_sales/pos_sale_lines for COMPLETED sales in scope) ----
  sale_count integer NOT NULL DEFAULT 0,
  gross_sales_total numeric(20,6) NOT NULL DEFAULT 0,   -- sum(pos_sales.subtotal): list-price extended, before discount/tax
  discount_total numeric(20,6) NOT NULL DEFAULT 0,      -- sum(pos_sales.discount_total)
  tax_total numeric(20,6) NOT NULL DEFAULT 0,           -- sum(pos_sales.tax_total)
  net_sales_total numeric(20,6) NOT NULL DEFAULT 0,     -- gross_sales_total - discount_total (taxable base actually sold, excl. tax)
  rounding_total numeric(20,6) NOT NULL DEFAULT 0,      -- sum(pos_sales.rounding_adjustment)
  grand_sales_total numeric(20,6) NOT NULL DEFAULT 0,   -- sum(pos_sales.grand_total) = net_sales_total + tax_total + rounding_total

  -- ---- Returns/refunds (from tenant.pos_returns, status='completed' in
  -- scope). refund_total is tax-inclusive as pos_return_lines stores it
  -- (pos_return_lines has no separate tax component to decompose) — this is
  -- a documented, deliberate simplification, not an oversight.
  return_count integer NOT NULL DEFAULT 0,
  return_total numeric(20,6) NOT NULL DEFAULT 0,

  -- ---- Tender breakdown: method-agnostic, grouped from tenant.pos_payments
  -- for the same completed sales, by whatever payment_method values are
  -- actually present (only 'cash' is reachable in this codebase today —
  -- every other method fails closed in completePointOfSale/completePosCart
  -- pending a provider adapter — but this column never hardcodes that).
  -- Shape: [{ "method": "cash", "amount": "236.000000", "count": 3 }, ...]
  tender_totals jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ---- Cash drawer reconciliation (from tenant.pos_cash_movements for the
  -- shifts in scope; signed-amount convention per cash-movements: opening/
  -- sale/paid_in positive = cash added, refund/paid_out negative = cash
  -- removed — see completePointOfSale/closeShift in index.js, the only
  -- code in this snapshot that writes these rows).
  opening_cash_total numeric(20,6) NOT NULL DEFAULT 0,
  paid_in_total numeric(20,6) NOT NULL DEFAULT 0,
  paid_out_total numeric(20,6) NOT NULL DEFAULT 0,
  expected_cash_total numeric(20,6) NOT NULL DEFAULT 0, -- sum(pos_cash_movements.amount) over every movement in scope — the same definition closeShift() already uses per-shift
  counted_cash_total numeric(20,6),                     -- sum of each included (closed) shift's own counted_cash; NULL only if no shift in scope ever recorded one
  cash_variance_total numeric(20,6) NOT NULL DEFAULT 0, -- counted_cash_total - expected_cash_total

  -- ---- Lineage: exactly which source rows fed this report, required for
  -- audit and for F304 to cross-reference. JSONB (not a child table) for
  -- the same reason pos_sale_lines.tax_components is JSONB elsewhere in
  -- this module: a fixed-shape read-only snapshot array, never queried by
  -- its own foreign key, only ever read back whole.
  -- Shape: { "shiftIds": [uuid...], "saleIds": [uuid...],
  --          "returnIds": [uuid...], "cashMovementIds": [uuid...] }
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ---- Real, typed placeholders for the F304 reconciliation workstream.
  -- Nothing in this migration or in day-end-reports.js ever writes a
  -- non-default value into these three columns — they exist so F304 has a
  -- stable column shape to attach to via this report's id, without F303
  -- guessing at F304's own reconciliation-record shape. See the
  -- immutability trigger below: these three (plus reviewed_by/reviewed_at/
  -- finalized_by/finalized_at/updated_at) are the ONLY columns a closed
  -- report may still receive a value in — every reconciled total and the
  -- lineage above is frozen the moment status='closed'.
  reconciliation_status text NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('pending','matched','exception')),
  reconciliation_references jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ "type": "...", "id": "...", "note": "..." }, ...], populated by F304
  outstanding_exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,    -- offline/outstanding-payment exceptions, populated by F304

  generated_by uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  finalized_by uuid,
  finalized_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (scope_type<>'shift' OR shift_id IS NOT NULL),
  CHECK (scope_type<>'business_day' OR shift_id IS NULL)
);

-- report_number is allocated via nextDocumentNumber() with a periodKey
-- scoped to store+terminal+business_date+scope_type (see
-- day-end-reports.js), the same "period + store + terminal" numbering the
-- F303 brief asks for — each such scope's own sequence starts at 1, so the
-- printed text ("ZREP-000001") is NOT globally unique across different
-- stores/terminals by itself. Uniqueness is therefore scoped to
-- (organization, store, terminal-or-store-wide) here, mirroring the two
-- partial indexes above, rather than the plain org-wide
-- UNIQUE(organization_id,report_number) this migration started with (which
-- collided the first time two different scopes both allocated their own
-- "#1" -- the exact per-terminal-counter mistake index.js's own receipt-
-- number comment already documents and this schema deliberately avoids
-- repeating at the report_number layer).
CREATE UNIQUE INDEX IF NOT EXISTS pos_day_end_reports_number_scope_uidx
  ON tenant.pos_day_end_reports(
    organization_id,store_id,
    (coalesce(terminal_id,'00000000-0000-0000-0000-000000000000'::uuid)),
    report_number
  );

-- Duplicate-prevention policy (explicit choice, documented since the brief
-- allows either): generatePosDayEndReport is IDEMPOTENT, not rejecting.
-- Calling it again for a scope that already has a non-void report either
-- (a) recomputes and updates that SAME row in place while it is still
-- 'draft' (never creates a second row — see the partial unique indexes
-- below, which are the real enforcement, not just application logic), or
-- (b) once 'reviewed'/'closed', returns the existing row unchanged. A
-- genuinely new figure discovered after close is a linked correction
-- (tenant.pos_day_end_report_corrections below), never a second report for
-- the same scope.
CREATE UNIQUE INDEX IF NOT EXISTS pos_day_end_reports_shift_scope_uidx
  ON tenant.pos_day_end_reports(organization_id,shift_id)
  WHERE status<>'void' AND scope_type='shift';

CREATE UNIQUE INDEX IF NOT EXISTS pos_day_end_reports_day_scope_uidx
  ON tenant.pos_day_end_reports(
    organization_id,company_id,store_id,
    (coalesce(terminal_id,'00000000-0000-0000-0000-000000000000'::uuid)),
    business_date
  )
  WHERE status<>'void' AND scope_type='business_day';

CREATE INDEX IF NOT EXISTS pos_day_end_reports_store_date_idx
  ON tenant.pos_day_end_reports(organization_id,company_id,store_id,business_date DESC);
CREATE INDEX IF NOT EXISTS pos_day_end_reports_status_idx
  ON tenant.pos_day_end_reports(organization_id,company_id,status);

-- A closed report is immutable except for the three F304 reconciliation-
-- attachment columns (plus reviewed_/finalized_ actor+timestamp columns and
-- updated_at, which the state-machine functions themselves set exactly
-- once on the review/finalize transition and never again). Every reconciled
-- total, tender/lineage snapshot and identity/scope column is frozen the
-- instant status='closed'. Modeled directly on
-- tenant.accounting_protect_posted_subledger_document() (migration 011).
CREATE OR REPLACE FUNCTION tenant.pos_day_end_report_protect_closed()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_payload jsonb; new_payload jsonb;
BEGIN
  IF TG_OP='DELETE' AND OLD.status IN ('closed','void') THEN
    RAISE EXCEPTION 'A closed POS day-end report cannot be deleted; record a correction instead';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='closed' THEN
    old_payload := to_jsonb(OLD) - ARRAY[
      'reconciliation_status','reconciliation_references','outstanding_exceptions',
      'reviewed_by','reviewed_at','finalized_by','finalized_at','updated_at'
    ];
    new_payload := to_jsonb(NEW) - ARRAY[
      'reconciliation_status','reconciliation_references','outstanding_exceptions',
      'reviewed_by','reviewed_at','finalized_by','finalized_at','updated_at'
    ];
    IF old_payload IS DISTINCT FROM new_payload THEN
      RAISE EXCEPTION 'A closed POS day-end report is immutable; record a linked correction instead of editing it';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;

DROP TRIGGER IF EXISTS pos_day_end_reports_closed_immutable ON tenant.pos_day_end_reports;
CREATE TRIGGER pos_day_end_reports_closed_immutable
  BEFORE UPDATE OR DELETE ON tenant.pos_day_end_reports
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_day_end_report_protect_closed();

-- A correction/variance against an already-closed report. Append-only by
-- convention (no update/delete function is ever exposed for this table);
-- the original report row is never touched — see recordPosDayEndVariance.
CREATE TABLE IF NOT EXISTS tenant.pos_day_end_report_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  original_report_id uuid NOT NULL REFERENCES tenant.pos_day_end_reports(id),
  correction_number text NOT NULL,
  variance_type text NOT NULL CHECK (variance_type IN ('cash_variance','total_adjustment','reclassification','other')),
  reason text NOT NULL,
  -- Free-form, typed-at-the-application-layer description of exactly what
  -- changed (e.g. [{ "field": "cash_variance_total", "previousValue": "...",
  -- "correctedValue": "..." }]) — the ORIGINAL report row's own columns
  -- never change, this is purely additive evidence.
  adjustment jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,correction_number)
);

CREATE INDEX IF NOT EXISTS pos_day_end_report_corrections_report_idx
  ON tenant.pos_day_end_report_corrections(organization_id,original_report_id,created_at DESC);

-- Append-only: no UPDATE or DELETE is ever legitimate for a correction row.
CREATE OR REPLACE FUNCTION tenant.pos_day_end_report_corrections_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POS day-end report corrections are append-only';
END;
$$;
DROP TRIGGER IF EXISTS pos_day_end_report_corrections_immutable ON tenant.pos_day_end_report_corrections;
CREATE TRIGGER pos_day_end_report_corrections_immutable
  BEFORE UPDATE OR DELETE ON tenant.pos_day_end_report_corrections
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_day_end_report_corrections_append_only();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pos_day_end_reports',
    'pos_day_end_report_corrections'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
