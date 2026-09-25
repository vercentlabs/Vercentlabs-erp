BEGIN;

-- The CRM saved-views bar ("All / +") above the Leads and Opportunities lists
-- and the Reports screen was removed from the product, along with its API
-- resource. Nothing else references tenant.crm_saved_views (no foreign keys or
-- views depend on it), so the table goes too. Sales' own saved-view tables
-- (quotations, orders) are unrelated and stay.
DROP TABLE IF EXISTS tenant.crm_saved_views;

COMMIT;
