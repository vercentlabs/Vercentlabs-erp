BEGIN;

-- Prompt 12 (Emergency P0 Integrity Fixes).
--
-- Root cause (confirmed live before this fix — see
-- docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md, Section 3):
-- `crm.records.view_all` was added to packages/permissions/src/modules/crm/index.js and
-- granted to 7 role templates in apps/web/src/core/access-control.ts by
-- Prompt 3 (Security Hardening), but Prompt 3's own migration-scope
-- decision ("No migration was created" — ERP_SECURITY_HARDENING_003.md
-- Section 9) was about the CRM ownership *columns*
-- (crm_leads.owner_user_id / crm_activities.assigned_to), which genuinely
-- already existed and needed no migration. It did not register the new
-- *permission key* in the persisted `permissions` catalogue table at all.
--
-- role_permissions.permission_key has a hard foreign key to
-- permissions(key) (002_platform_foundation.sql). seedOrganizationFoundation()
-- (apps/web/src/core/platform.ts) inserts one role_permissions row per
-- ROLE_TEMPLATES permission, inside a single transaction() with no
-- per-row try/catch — so any new-organization onboarding that seeds one
-- of the 7 affected role templates throws a foreign-key violation and
-- aborts the entire onboarding transaction. Confirmed live against the
-- running database immediately before writing this migration: 0 rows in
-- `permissions` and 0 rows in `role_permissions` for this key.
--
-- Same pattern as migrations 030/031: register the key in the global
-- `permissions` table, then grant it directly to every existing
-- organization's already-materialized system-role rows, since a
-- TypeScript-only change (access-control.ts's ROLE_TEMPLATES) only takes
-- effect for organizations created after this migration ships.
--
-- Role grants match Prompt 3's own documented policy exactly
-- (ERP_SECURITY_HARDENING_003.md, Section 5): every currently-defined
-- CRM/sales elevated role EXCEPT Sales Representative — confirmed by
-- reading every occurrence of "crm.records.view_all" in
-- access-control.ts's ROLE_TEMPLATES directly before writing this
-- migration (7 roles, sales_representative deliberately not among them,
-- matching Prompt 3's owner/assignee-scope-by-default rule).
-- organization_owner/system_administrator/company_administrator hold the
-- permission via `ALL_PERMISSIONS` in the TypeScript role template and
-- are backfilled here for the same reason migration 031 backfilled them
-- for automation.view/integrations.view/data_management.view — a
-- TypeScript-computed permission list does not retroactively update an
-- already-materialized organization's role_permissions rows.

INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.records.view_all', 'View all CRM team records', 'CRM', 'See every CRM lead, opportunity and activity within company/branch scope, not just records owned by or assigned to the caller.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'crm.records.view_all'
FROM roles r
WHERE r.is_system = true
  AND r.slug IN (
    'organization_owner',
    'system_administrator',
    'company_administrator',
    'crm_administrator',
    'sales_head',
    'sales_manager',
    'sales_operations',
    'marketing_manager',
    'customer_success_manager',
    'partner_manager'
  )
ON CONFLICT DO NOTHING;

COMMIT;
