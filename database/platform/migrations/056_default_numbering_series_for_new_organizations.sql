BEGIN;

-- Bug: an organisation created through self-serve registration (registerOrganization) had NO numbering_series rows.
-- Earlier migrations seeded series only for the organisations that existed when they ran, so a new organisation's
-- first "New account" (and lead, opportunity, contact, activity, ...) failed with
-- CRM_ACCOUNT_NUMBERING_UNAVAILABLE ("Account numbering is not configured for this organisation").
-- ensure_default_numbering_series(org) is now called by registerOrganization when it creates an organisation, and
-- existing organisations missing any of them are repaired here. It is deliberately not a trigger: integration tests
-- create organisations directly and seed their own series. A series an administrator already
-- customised (any existing row for that entity type) is left exactly as it is.
CREATE OR REPLACE FUNCTION ensure_default_numbering_series(target_organization uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO numbering_series (organization_id, entity_type, prefix, next_number, padding, status)
  SELECT target_organization, d.entity_type, d.prefix, 1, d.padding, 'active'
  FROM (VALUES
    ('business_party', 'PTY-', 5), ('contact', 'CON-', 5), ('crm_activity', 'ACT-', 5), ('crm_campaign', 'CMP-', 5),
    ('crm_lead', 'LEAD-', 5), ('crm_opportunity', 'OPP-', 5),
    ('customer', 'CUS-', 5), ('supplier', 'SUP-', 5), ('item', 'ITM-', 5), ('warehouse', 'WH-', 5),
    ('employee', 'EMP-', 5), ('asset', 'AST-', 5), ('fixed_asset', 'FA-', 5),
    ('price_list', 'PL-', 5), ('quotation', 'QUO-', 5), ('sales_order', 'SO-', 5),
    ('sales_fulfillment_request', 'FUL-', 5), ('sales_invoice_request', 'SIR-', 5),
    ('fulfillment_request', 'FUL-', 5), ('invoice_request', 'INV-', 5), ('invoice', 'INV-', 5),
    ('purchase_order', 'PO-', 5), ('purchase_requisition', 'PR-', 6),
    ('customer_invoice', 'INV-', 5), ('customer_receipt', 'RCT-', 5), ('customer_credit_note', 'CRN-', 5),
    ('vendor_bill', 'BILL-', 5), ('vendor_payment', 'PAY-', 5), ('vendor_credit_note', 'VCN-', 5),
    ('journal_entry', 'JE-', 5), ('bank_statement', 'STMT-', 5),
    ('accounting_close_run', 'CLS-', 5), ('accounting_consolidation_run', 'CON-', 5),
    ('accounting_revaluation_run', 'FXR-', 5), ('accounting_tax_return', 'TAX-', 5)
  ) AS d(entity_type, prefix, padding)
  ON CONFLICT (organization_id, entity_type) DO NOTHING;
END;
$$;

SELECT ensure_default_numbering_series(id) FROM organizations;

COMMIT;
