BEGIN;

-- One numbering system (Shared Platform, Prompt 5).
--
-- tenant.document_sequences (counter state) + tenant.document_numbering_policies
-- (administrator configuration) + the platform allocator nextDocumentNumber()
-- replace public.numbering_series, which CRM, Sales, Accounting and Procurement
-- used as an organisation-wide counter. Those document families stay
-- organisation-wide (their identifiers are unique per organisation): their
-- counters live in document_sequences keyed by the organisation id in the
-- company column (the table has no company foreign key).
--
-- Migration rules (never re-issue an identifier):
--   * every legacy series becomes an organisation-level policy with its exact
--     prefix and padding, so identifiers keep their format;
--   * its counter starts at the HIGHEST of: the legacy next number, and one
--     past the largest number already stored on the documents themselves
--     (parsed for the families below; values that do not parse are ignored,
--     the legacy next number remains the floor);
--   * Procurement's old per-company fallback counters ("procurement:<type>")
--     raise the organisation counter floor too, and when an organisation had no
--     legacy series for that type, its policy keeps the fallback's format;
--   * legacy "fiscal_year_reset" was never honoured by the old code (it never
--     reset), so every migrated policy is "never", matching what was issued.
-- public.numbering_series itself is left in place (read by nothing) for Prompt 6
-- to remove.

CREATE TABLE IF NOT EXISTS tenant.document_numbering_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid,
  document_type text NOT NULL,
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z0-9][A-Z0-9/_-]{0,23}$'),
  padding integer NOT NULL CHECK (padding BETWEEN 1 AND 18),
  reset_policy text NOT NULL DEFAULT 'never' CHECK (reset_policy IN ('never', 'calendar_year', 'fiscal_year')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS document_numbering_policies_scope_uidx
  ON tenant.document_numbering_policies (organization_id, COALESCE(company_id, organization_id), document_type);

ALTER TABLE tenant.document_numbering_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.document_numbering_policies FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'document_numbering_policies' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.document_numbering_policies
      USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;

-- Largest numeric suffix already stored for <prefix> in <table>.<column> of one organisation.
CREATE OR REPLACE FUNCTION pg_temp.max_issued_number(target_table text, target_column text, org uuid, number_prefix text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  result numeric;
BEGIN
  IF to_regclass(target_table) IS NULL THEN RETURN 0; END IF;
  EXECUTE format(
    'SELECT max(substr(%1$I, length($2) + 1)::numeric) FROM %2$s
      WHERE organization_id = $1 AND left(%1$I, length($2)) = $2 AND substr(%1$I, length($2) + 1) ~ ''^[0-9]{1,15}$''',
    target_column, target_table)
    INTO result USING org, number_prefix;
  RETURN COALESCE(result, 0)::bigint;
END $$;

CREATE TEMP TABLE numbering_family_columns (entity_type text PRIMARY KEY, target_table text, target_column text) ON COMMIT DROP;
INSERT INTO numbering_family_columns VALUES
  ('crm_lead', 'tenant.crm_leads', 'code'),
  ('crm_opportunity', 'tenant.crm_opportunities', 'code'),
  ('crm_campaign', 'tenant.crm_campaigns', 'code'),
  ('business_party', 'tenant.business_parties', 'code'),
  ('quotation', 'tenant.sales_quotations', 'quotation_number'),
  ('sales_order', 'tenant.sales_orders', 'sales_order_number'),
  ('journal_entry', 'tenant.accounting_journal_entries', 'entry_number'),
  ('customer_invoice', 'tenant.accounting_customer_invoices', 'invoice_number'),
  ('customer_credit_note', 'tenant.accounting_customer_invoices', 'invoice_number'),
  ('vendor_bill', 'tenant.accounting_vendor_bills', 'bill_number'),
  ('vendor_credit_note', 'tenant.accounting_vendor_bills', 'bill_number'),
  ('vendor_payment', 'tenant.accounting_vendor_payments', 'payment_number'),
  ('customer_receipt', 'tenant.accounting_customer_receipts', 'receipt_number');
-- (Procurement stores its numbers inside record payloads; its floor is the legacy
-- next number and the per-company fallback counters below.)

-- 1. Legacy organisation-wide series -> organisation policy + counter.
INSERT INTO tenant.document_numbering_policies (organization_id, company_id, document_type, prefix, padding, reset_policy, status)
SELECT series.organization_id, NULL, series.entity_type, upper(series.prefix), LEAST(GREATEST(series.padding, 1), 18), 'never', 'active'
  FROM public.numbering_series series
 WHERE upper(series.prefix) ~ '^[A-Z0-9][A-Z0-9/_-]{0,23}$'
ON CONFLICT DO NOTHING;

INSERT INTO tenant.document_sequences (organization_id, company_id, document_type, period_key, prefix, padding, next_value)
SELECT series.organization_id, series.organization_id, series.entity_type, 'global', upper(series.prefix), LEAST(GREATEST(series.padding, 1), 18),
       GREATEST(
         series.next_number,
         1,
         COALESCE((SELECT pg_temp.max_issued_number(family.target_table, family.target_column, series.organization_id, series.prefix)
                     FROM numbering_family_columns family WHERE family.entity_type = series.entity_type), 0) + 1
       )
  FROM public.numbering_series series
ON CONFLICT (organization_id, company_id, document_type, period_key)
DO UPDATE SET next_value = GREATEST(tenant.document_sequences.next_value, EXCLUDED.next_value), updated_at = now();

-- 2. Procurement's per-company fallback counters -> the organisation counter.
CREATE TEMP TABLE procurement_fallbacks ON COMMIT DROP AS
SELECT organization_id,
       substr(document_type, length('procurement:') + 1) AS entity_type,
       max(next_value) AS next_value,
       (array_agg(prefix ORDER BY next_value DESC))[1] AS prefix,
       max(padding) AS padding
  FROM tenant.document_sequences
 WHERE document_type LIKE 'procurement:%' AND period_key = 'global'
 GROUP BY organization_id, substr(document_type, length('procurement:') + 1);

INSERT INTO tenant.document_numbering_policies (organization_id, company_id, document_type, prefix, padding, reset_policy, status)
SELECT fallback.organization_id, NULL, fallback.entity_type, upper(regexp_replace(fallback.prefix, '-+$', '')) || '-', fallback.padding, 'never', 'active'
  FROM procurement_fallbacks fallback
 WHERE upper(regexp_replace(fallback.prefix, '-+$', '')) || '-' ~ '^[A-Z0-9][A-Z0-9/_-]{0,23}$'
ON CONFLICT DO NOTHING;

INSERT INTO tenant.document_sequences (organization_id, company_id, document_type, period_key, prefix, padding, next_value)
SELECT fallback.organization_id, fallback.organization_id, fallback.entity_type, 'global', upper(regexp_replace(fallback.prefix, '-+$', '')) || '-', fallback.padding, fallback.next_value
  FROM procurement_fallbacks fallback
ON CONFLICT (organization_id, company_id, document_type, period_key)
DO UPDATE SET next_value = GREATEST(tenant.document_sequences.next_value, EXCLUDED.next_value), updated_at = now();

COMMENT ON TABLE public.numbering_series IS
  'RETIRED (tenant migration 181): migrated into tenant.document_sequences + tenant.document_numbering_policies. Read by nothing; dropped in Prompt 6.';

COMMIT;
