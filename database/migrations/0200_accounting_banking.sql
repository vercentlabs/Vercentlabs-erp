-- Finance MVP F6: Banking.
--
-- 1. A cash account has a person responsible for it (its custodian); a bank or cash account keeps a note.
-- 2. A transfer whose money arrives on a later day passes through "Funds in transit": sent (Dr transit · Cr from), then received
--    (Dr to · Cr transit) — never income or expense. The account and its posting rule are added for every company.
-- 3. Statement lines carry their reconciliation work: the suggested ledger line with its score and reasons, an exception (with why, who,
--    when), and a fingerprint (date, direction, amount, reference) that finds a line already imported in an earlier statement.
--
-- Additive and re-runnable.

ALTER TABLE tenant.accounting_bank_accounts ADD COLUMN IF NOT EXISTS custodian_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_bank_accounts ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE tenant.accounting_fund_transfers ADD COLUMN IF NOT EXISTS arrival_date date;
ALTER TABLE tenant.accounting_fund_transfers ADD COLUMN IF NOT EXISTS transit_account_id uuid REFERENCES tenant.accounting_accounts(id);
ALTER TABLE tenant.accounting_fund_transfers ADD COLUMN IF NOT EXISTS arrival_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.accounting_fund_transfers ADD COLUMN IF NOT EXISTS arrival_reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.accounting_fund_transfers ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE tenant.accounting_fund_transfers ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS suggested_journal_line_id uuid REFERENCES tenant.accounting_journal_lines(id);
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS suggestion_score numeric(5,2);
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS suggestion_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS exception_reason text;
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS exception_at timestamptz;
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS exception_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS line_fingerprint text;
ALTER TABLE tenant.accounting_bank_statement_lines ADD COLUMN IF NOT EXISTS duplicate_of_line_id uuid REFERENCES tenant.accounting_bank_statement_lines(id);
CREATE INDEX IF NOT EXISTS accounting_bank_statement_lines_fingerprint_idx ON tenant.accounting_bank_statement_lines (organization_id, line_fingerprint) WHERE line_fingerprint IS NOT NULL;
-- Lines imported before this release get their fingerprint too, so a re-import of an old statement is caught.
UPDATE tenant.accounting_bank_statement_lines line
   SET line_fingerprint = concat_ws('|', statement.bank_account_id, line.transaction_date, CASE WHEN line.debit_amount > 0 THEN 'D' ELSE 'C' END,
                                    trim(to_char(greatest(line.debit_amount, line.credit_amount), 'FM999999999999990.00')), lower(COALESCE(NULLIF(line.external_id, ''), NULLIF(line.reference, ''), '')))
  FROM tenant.accounting_bank_statements statement
 WHERE statement.id = line.bank_statement_id AND line.line_fingerprint IS NULL;

-- Funds in transit: one current-asset account under Cash and bank, and its posting rule, for every company.
INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
  allow_manual_posting, reconciliation_required, control_kind, status, created_by, updated_by)
SELECT ledger.organization_id, ledger.id, parent.id, '1195', 'Funds in transit', 'asset', 'current_asset', 'debit', false, false, true, NULL, 'active', ledger.created_by, ledger.created_by
  FROM tenant.accounting_ledgers ledger
  LEFT JOIN tenant.accounting_accounts parent ON parent.organization_id = ledger.organization_id AND parent.ledger_id = ledger.id AND parent.code = '1100' AND parent.is_group
 WHERE ledger.code = 'PRIMARY'
ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;

INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status, created_by, updated_by)
SELECT account.organization_id, account.ledger_id, 'funds_in_transit', account.id, 1000, 'active', account.created_by, account.created_by
  FROM tenant.accounting_accounts account
  JOIN tenant.accounting_ledgers ledger ON ledger.id = account.ledger_id AND ledger.code = 'PRIMARY'
 WHERE account.code = '1195' AND account.name = 'Funds in transit'
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings existing
                    WHERE existing.organization_id = account.organization_id AND existing.ledger_id = account.ledger_id AND existing.mapping_key = 'funds_in_transit');

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0200_accounting_banking.sql', 'accounting-banking') ON CONFLICT DO NOTHING;
