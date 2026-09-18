BEGIN;

-- F306 — Loyalty. Two new permission keys, following the exact pattern
-- migration 023 (pos.* catalogue) + 027/039 (role grants) already
-- established for this module.
--
-- pos.loyalty.manage: program configuration (earn rate, redemption value,
-- expiry policy) -- a financial/policy decision, so it sits at the same
-- supervisor/manager tier as pos.settings.manage, granted to pos_manager
-- and pos_supervisor only (mirrors pos.settings.manage's own tier, though
-- pos_supervisor does not hold pos.settings.manage itself -- loyalty
-- program configuration is judged less store-configuration-risk than
-- store/terminal management, so pos_supervisor is included here even
-- though it holds neither pos.settings.manage nor pos.store.manage/
-- pos.terminal.manage. If this is judged too permissive in a later
-- review, narrowing to pos_manager-only is a one-line change to the
-- seed below plus roles.js).
--
-- pos.loyalty.redeem: redeeming points at checkout is a normal checkout
-- action a cashier performs on every relevant sale, not a supervisor
-- override -- it sits alongside pos.sale.create on pos_cashier (and by
-- extension pos_supervisor/pos_manager, which already include
-- pos.sale.create).
INSERT INTO permissions (key,name,category,description) VALUES
('pos.loyalty.manage','Manage POS loyalty program','Point of Sale','Configure the loyalty program''s earn rate, redemption value and eligibility rules'),
('pos.loyalty.redeem','Redeem POS loyalty points','Point of Sale','Redeem a customer''s loyalty points against a sale at checkout')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('pos.loyalty.manage')
) AS p(permission_key)
WHERE r.is_system=true AND r.template_key IN ('pos_manager','pos_supervisor')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('pos.loyalty.redeem')
) AS p(permission_key)
WHERE r.is_system=true AND r.template_key IN ('pos_cashier','pos_supervisor','pos_manager')
ON CONFLICT DO NOTHING;

COMMIT;
