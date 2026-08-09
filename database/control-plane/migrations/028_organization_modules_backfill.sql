BEGIN;

-- Bug fix, found via a live sidebar screenshot showing only CRM/Sales/
-- Accounting/Procurement for an existing organization, despite Prompt 4-7
-- correctly resolving module access from organization_modules for all 12
-- released modules.
--
-- Root cause (confirmed against the running local database, not assumed):
-- migration 009 (crm release) seeded an organization_modules row for
-- EVERY existing organization across ALL 12 catalogue modules at once —
-- CRM 'enabled', every other module explicitly 'disabled' (matching the
-- product's state at that moment: only CRM was released). Migrations 012/
-- 013/014 (sales/accounting/procurement release) each correctly flipped
-- their own module's row to 'enabled' for every existing org. Migrations
-- 019-026 (stock, manufacturing, projects, assets, point-of-sale, quality,
-- support, hr-payroll) correctly added each module's PERMISSIONS rows but
-- never performed the equivalent organization_modules flip — each only
-- ran `INSERT INTO permissions`. The row from migration 009 was therefore
-- left stuck at status='disabled', enabled_at=NULL, forever — a state that
-- is otherwise unreachable through the app's own code (PATCH
-- /api/modules/[key] never clears enabled_at when disabling an
-- already-enabled module, so enabled_at IS NULL can only mean "never once
-- enabled"). Verified live: exactly 8 rows across the whole database match
-- this signature, all on the single oldest organization (created before
-- any of these 8 modules existed). New organizations were never affected —
-- apps/web/src/lib/platform.ts's seedOrganizationFoundation() already
-- iterates the full, current ERP_MODULE_CATALOG (all "released") for every
-- new org, so no org created after Prompt 4 ships with a disabled row.
--
-- Fix has two parts, both scoped to exactly the 8 affected modules:
--   1. UPDATE any row still in its untouched, never-enabled original-seed
--      state (status='disabled' AND enabled_at IS NULL) to 'enabled'. This
--      condition can only match a pristine post-009-seed row, never a row
--      an administrator has ever actually enabled or disabled themselves
--      (see above) — so this can never silently override a deliberate
--      admin action.
--   2. INSERT any row that's missing outright (an org created between two
--      of these release migrations could theoretically have no row at all
--      for a given module), ON CONFLICT DO NOTHING so it can never
--      overwrite an existing explicit row either.
WITH module_seed(module_key, name) AS (
  VALUES
    ('stock', 'Stock'),
    ('manufacturing', 'Manufacturing'),
    ('projects', 'Projects'),
    ('assets', 'Assets'),
    ('point-of-sale', 'Point of Sale'),
    ('quality', 'Quality'),
    ('support', 'Support'),
    ('hr-payroll', 'HR & Payroll')
)
UPDATE organization_modules
SET status = 'enabled', enabled_at = now(), updated_at = now()
FROM module_seed seed
WHERE organization_modules.module_key = seed.module_key
  AND organization_modules.status = 'disabled'
  AND organization_modules.enabled_at IS NULL;

WITH module_seed(module_key, name) AS (
  VALUES
    ('stock', 'Stock'),
    ('manufacturing', 'Manufacturing'),
    ('projects', 'Projects'),
    ('assets', 'Assets'),
    ('point-of-sale', 'Point of Sale'),
    ('quality', 'Quality'),
    ('support', 'Support'),
    ('hr-payroll', 'HR & Payroll')
)
INSERT INTO organization_modules (
  organization_id, module_key, name, status, enabled_at
)
SELECT
  organization.id,
  seed.module_key,
  seed.name,
  'enabled',
  now()
FROM organizations organization
CROSS JOIN module_seed seed
ON CONFLICT (organization_id, module_key) DO NOTHING;

COMMIT;
