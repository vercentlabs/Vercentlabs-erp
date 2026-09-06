BEGIN;

-- F040 gap: tenant.sales_tax_groups/sales_tax_group_components and the
-- tax_group_id column on sales_quotation_lines/sales_order_lines were
-- created (008_sales_module.sql) alongside the real, active tax engine
-- (calculateLine in services/api/src/modules/sales/index.js), but
-- calculateLine computes CGST/SGST/IGST inline from tenant.tax_rates/
-- tax_categories and never queries either tax-group table - tax_group_id
-- is always written NULL. Confirmed via a full-repo grep: no application
-- code, UI, or test anywhere else references sales_tax_groups,
-- sales_tax_group_components, or tax_group_id. Same shape of finding as
-- CRM's F013 (an unused schema sitting alongside the real implementation)
-- and resolved the same way: drop the unused schema rather than carry two
-- parallel tax models indefinitely.
ALTER TABLE tenant.sales_quotation_lines DROP COLUMN IF EXISTS tax_group_id;
ALTER TABLE tenant.sales_order_lines DROP COLUMN IF EXISTS tax_group_id;

DROP TABLE IF EXISTS tenant.sales_tax_group_components;
DROP TABLE IF EXISTS tenant.sales_tax_groups;

COMMIT;
