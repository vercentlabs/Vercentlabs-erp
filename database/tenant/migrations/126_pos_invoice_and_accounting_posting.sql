BEGIN;

-- F290 (invoice generation) / F305 (accounting posting). POS never builds
-- its own invoice or general-ledger model -- it links to the authoritative
-- ones Accounting already owns: tenant.accounting_customer_invoices (a
-- real, generic AR invoice/credit-note document, already used by Sales'
-- own invoice-request pipeline) and tenant.accounting_journal_entries (the
-- authoritative GL). pos_sales.accounting_invoice_id has existed since
-- migration 048 but was never an enforced FK and never populated by any
-- function -- this migration gives it real referential integrity and adds
-- the journal-linkage/posting-status columns F305 needs.
ALTER TABLE tenant.pos_sales
  ADD CONSTRAINT pos_sales_accounting_invoice_id_fkey
    FOREIGN KEY (accounting_invoice_id) REFERENCES tenant.accounting_customer_invoices(id);

ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS invoice_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_generated_by uuid,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  -- 'not_applicable' covers a sale still short of what F305 needs to post
  -- (e.g. never reaches it -- every completed sale should eventually post,
  -- so this value is really only a safe column default, not a real resting
  -- state for a completed sale).
  ADD COLUMN IF NOT EXISTS accounting_posting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_posting_status IN ('pending','posted','failed','not_applicable')),
  ADD COLUMN IF NOT EXISTS accounting_posting_error text,
  ADD COLUMN IF NOT EXISTS accounting_posted_at timestamptz;

-- A voided/draft/never-completed sale is never a posting candidate; flip
-- the default forward only for rows that can actually reach 'completed'.
-- (Existing rows keep whatever status they already have -- 'pending' is a
-- safe default for historical completed sales too, since F305's batch
-- poster treats 'pending' as "eligible, not yet attempted", not an error.)

ALTER TABLE tenant.pos_returns
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  ADD COLUMN IF NOT EXISTS accounting_posting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_posting_status IN ('pending','posted','failed','not_applicable')),
  ADD COLUMN IF NOT EXISTS accounting_posting_error text,
  ADD COLUMN IF NOT EXISTS accounting_posted_at timestamptz;

CREATE INDEX IF NOT EXISTS pos_sales_accounting_posting_status_idx
  ON tenant.pos_sales(organization_id,company_id,accounting_posting_status)
  WHERE status IN ('completed','partially_returned','returned');
CREATE INDEX IF NOT EXISTS pos_returns_accounting_posting_status_idx
  ON tenant.pos_returns(organization_id,company_id,accounting_posting_status)
  WHERE status='completed';

COMMIT;
