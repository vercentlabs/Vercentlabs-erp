BEGIN;

-- POS Implementation Tracker (docs/03-modules/point-of-sale/POS_IMPLEMENTATION_TRACKER.md),
-- Tranche 0: the only POS role that existed (pos_manager) held both
-- pos.return.create and pos.return.approve — every "self-approval blocked"
-- guarantee in the POS return-approval code only worked because two
-- DIFFERENT PEOPLE happened to hold the same all-powerful role, not
-- because the role model itself separated the two actions. This adds a
-- real least-privilege cashier tier and a supervisor override tier,
-- mirroring the accountant/finance_manager and sales quotation
-- create/approve split already established elsewhere in this catalogue.
--
-- packages/permissions/src/roles.js is the authoritative, tested source
-- (packages/permissions/tests/roles.test.mjs asserts every role's
-- permissions exist in the canonical catalogue, that non-privileged roles
-- carry no blocking SoD conflict, and so on) — this migration is a
-- point-in-time copy of that source into the database's role catalogue,
-- following the exact pattern migration 027 already established.

WITH template(name,slug,description,module_key,risk_level,assignable) AS (
  VALUES
    ('POS Cashier','pos_cashier','Least-privilege checkout operation: open/close an assigned shift, ring up sales, request returns. No overrides, no approvals, no store/terminal configuration.','point-of-sale','standard',true),
    ('POS Supervisor','pos_supervisor','Store-floor override authority: approve returns, apply discounts and price overrides, adjust cash, view reports. Does not create returns itself and does not configure stores/terminals/settings.','point-of-sale','sensitive',true)
)
INSERT INTO roles(organization_id,name,slug,description,is_system,module_key,template_key,assignable,risk_level)
SELECT o.id,t.name,t.slug,t.description,true,t.module_key,t.slug,t.assignable,t.risk_level
FROM organizations o CROSS JOIN template t
ON CONFLICT (organization_id,slug) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  module_key=EXCLUDED.module_key,
  template_key=EXCLUDED.template_key,
  assignable=EXCLUDED.assignable,
  risk_level=EXCLUDED.risk_level,
  is_system=true,
  status='active',
  updated_at=now();

DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id=r.id AND r.is_system=true
  AND r.template_key IN ('pos_cashier','pos_supervisor');

WITH seed(role_slug,permission_key) AS (
  VALUES
    ('pos_cashier','workspace.view'),
    ('pos_cashier','notifications.view'),
    ('pos_cashier','profile.manage'),
    ('pos_cashier','business_data.view'),
    ('pos_cashier','stock.view'),
    ('pos_cashier','pos.view'),
    ('pos_cashier','pos.operate'),
    ('pos_cashier','pos.shift.open'),
    ('pos_cashier','pos.shift.close'),
    ('pos_cashier','pos.sale.create'),
    ('pos_cashier','pos.return.create'),

    ('pos_supervisor','workspace.view'),
    ('pos_supervisor','notifications.view'),
    ('pos_supervisor','profile.manage'),
    ('pos_supervisor','business_data.view'),
    ('pos_supervisor','stock.view'),
    ('pos_supervisor','stock.issue'),
    ('pos_supervisor','pos.view'),
    ('pos_supervisor','pos.operate'),
    ('pos_supervisor','pos.shift.open'),
    ('pos_supervisor','pos.shift.close'),
    ('pos_supervisor','pos.sale.create'),
    ('pos_supervisor','pos.discount.apply'),
    ('pos_supervisor','pos.return.approve'),
    ('pos_supervisor','pos.cash.adjust'),
    ('pos_supervisor','pos.price.override'),
    ('pos_supervisor','pos.reports.view')
)
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,s.permission_key
FROM seed s
JOIN roles r ON r.slug=s.role_slug AND r.is_system=true
ON CONFLICT DO NOTHING;

-- pos_manager keeps pos.return.approve (module-level admin oversight) but
-- loses pos.return.create — the same role granting both is the exact
-- pos_return_create_approve blocking SoD conflict this migration exists
-- to close. Day-to-day return creation now belongs to pos_cashier/
-- pos_supervisor; a person who genuinely needs both is assigned an
-- additional role rather than getting both actions from one grant.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id=r.id
  AND r.is_system=true AND r.template_key='pos_manager'
  AND rp.permission_key='pos.return.create';

COMMIT;
