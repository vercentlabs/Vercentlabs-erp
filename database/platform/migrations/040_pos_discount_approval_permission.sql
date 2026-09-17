BEGIN;

-- POS Session 3 (docs/03-modules/point-of-sale/POS_IMPLEMENTATION_TRACKER.md),
-- F279 security fix: cart.js's discount-approval flow used to trust a
-- caller-supplied `approvedBy` user id with no check that person ever
-- authenticated or made a decision. The fix routes above-threshold
-- discounts through the platform's real maker-checker engine
-- (services/api/src/core/approvals.js's decideApproval(), command_key
-- "pos.discount.approve"), which re-checks a genuine `pos.discount.approve`
-- permission on the actual deciding session. Before this migration no such
-- permission existed and pos_manager held pos.discount.apply -- holding
-- both apply and approve on the same role is exactly the same blocking
-- SoD-conflict shape migration 039 already fixed for pos.return.create/
-- approve, so pos_manager now holds approve instead of apply, matching
-- packages/permissions/src/roles.js (the authoritative, tested source;
-- packages/permissions/tests/roles.test.mjs asserts no non-privileged role
-- carries a blocking SoD conflict).

INSERT INTO permissions (key,name,category,description) VALUES
('pos.discount.approve','Approve POS discounts','Point of Sale','Decide a pending above-threshold discount request as the required separate approver')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id=r.id
  AND r.is_system=true AND r.template_key='pos_manager'
  AND rp.permission_key='pos.discount.apply';

WITH seed(role_slug,permission_key) AS (
  VALUES ('pos_manager','pos.discount.approve')
)
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,s.permission_key
FROM seed s
JOIN roles r ON r.slug=s.role_slug AND r.is_system=true
ON CONFLICT DO NOTHING;

-- Explicit, self-contained grant to the two roles that implicitly already
-- have every permission via ALL_PERMISSIONS (organization_owner,
-- system_administrator) -- matches migration 030's established pattern of
-- not depending on that implicit mechanism alone.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'pos.discount.approve'
FROM roles r
WHERE r.is_system = true
  AND r.slug IN ('organization_owner', 'system_administrator')
ON CONFLICT DO NOTHING;

COMMIT;
