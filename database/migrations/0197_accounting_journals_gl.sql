-- Finance MVP F2: Journals and General Ledger.
--
-- 1. A correction journal points at the entry it corrects (reverse-and-correct keeps the trail: original → reversal → correction).
-- 2. A posted entry is immutable. Marking it reversed may change only the reversal fields; every other column stays as posted.
-- 3. A discarded (cancelled) journal is final: it can't be revived or changed.
-- 4. The company's manual-journal approval policy: on (the default, as before) every manual journal from the threshold amount up needs a
--    second person's approval; off, only journals marked "approval required" do — so a company with one finance user can still post.
--
-- Additive and re-runnable.

ALTER TABLE tenant.accounting_journal_entries ADD COLUMN IF NOT EXISTS correction_of_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_journal_entries_correction_of_fkey') THEN
    ALTER TABLE tenant.accounting_journal_entries
      ADD CONSTRAINT accounting_journal_entries_correction_of_fkey FOREIGN KEY (correction_of_id) REFERENCES tenant.accounting_journal_entries(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS accounting_journal_entries_correction_of_idx ON tenant.accounting_journal_entries (organization_id, correction_of_id) WHERE correction_of_id IS NOT NULL;

ALTER TABLE tenant.accounting_settings ADD COLUMN IF NOT EXISTS manual_journal_approval boolean NOT NULL DEFAULT true;
-- The general journal follows that policy rather than a fixed flag of its own (the asset, closing and tax journals keep theirs).
UPDATE tenant.accounting_journals SET approval_required = false WHERE journal_type = 'general' AND approval_required;

CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A discarded journal is kept for the record' USING ERRCODE = 'check_violation'; END IF;
    RAISE EXCEPTION 'A discarded journal cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('posted','reversed') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Posted accounting entries cannot be deleted'; END IF;
    IF NEW.status = OLD.status OR NEW.status NOT IN ('reversed') THEN
      RAISE EXCEPTION 'Posted accounting entries are immutable; create a reversal';
    END IF;
    -- posted → reversed: only the reversal link, its reason and the touch columns may change.
    IF (NEW.ledger_id, NEW.journal_id, NEW.fiscal_period_id, NEW.entry_number, NEW.entry_date, NEW.accounting_date, NEW.document_date, NEW.entry_type,
        NEW.source_module, NEW.source_type, NEW.source_id, NEW.source_number, NEW.reference, NEW.description, NEW.currency_code, NEW.functional_currency_code,
        NEW.exchange_rate, NEW.content_hash, NEW.reversal_of_id, NEW.correction_of_id, NEW.posted_at, NEW.posted_by, NEW.approved_at, NEW.approved_by,
        NEW.submitted_at, NEW.submitted_by, NEW.created_by, NEW.created_at, NEW.organization_id)
       IS DISTINCT FROM
       (OLD.ledger_id, OLD.journal_id, OLD.fiscal_period_id, OLD.entry_number, OLD.entry_date, OLD.accounting_date, OLD.document_date, OLD.entry_type,
        OLD.source_module, OLD.source_type, OLD.source_id, OLD.source_number, OLD.reference, OLD.description, OLD.currency_code, OLD.functional_currency_code,
        OLD.exchange_rate, OLD.content_hash, OLD.reversal_of_id, OLD.correction_of_id, OLD.posted_at, OLD.posted_by, OLD.approved_at, OLD.approved_by,
        OLD.submitted_at, OLD.submitted_by, OLD.created_by, OLD.created_at, OLD.organization_id) THEN
      RAISE EXCEPTION 'Marking an entry reversed may change only its reversal details' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reversed_by_id IS NULL THEN RAISE EXCEPTION 'A reversed entry must point at the entry that reverses it' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0197_accounting_journals_gl.sql', 'accounting-journals-gl') ON CONFLICT DO NOTHING;
