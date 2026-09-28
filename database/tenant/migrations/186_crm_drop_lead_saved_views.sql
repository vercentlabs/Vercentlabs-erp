BEGIN;

-- The Lead-only saved views (migration 018, reworked by 073) predate the
-- shared CRM saved views that migration 179 already dropped; no code has read
-- or written tenant.crm_lead_saved_views since, and nothing depends on it (no
-- foreign keys or views), so the table goes too.
DROP TABLE IF EXISTS tenant.crm_lead_saved_views;

COMMIT;
