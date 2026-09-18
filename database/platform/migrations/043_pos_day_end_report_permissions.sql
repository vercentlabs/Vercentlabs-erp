BEGIN;

-- F303: day-end/Z report permissions. New permission keys must exist in the
-- global `permissions` catalogue (role_permissions.permission_key has a
-- foreign key into it -- see migration 023's INSERT for the precedent)
-- before any role can be granted them below.
INSERT INTO permissions (key,name,category,description) VALUES
('pos.report.generate','Generate POS day-end reports','Point of Sale','Generate/review a draft day-end (Z) report'),
('pos.report.finalize','Finalize POS day-end reports','Point of Sale','Finalize and lock a reviewed day-end (Z) report'),
('pos.report.view','View POS day-end reports','Point of Sale','View day-end (Z) reports')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

-- packages/permissions/src/roles.js is
-- the authoritative, tested source (packages/permissions/tests/
-- roles.test.mjs) -- this migration is a point-in-time copy of that grant
-- into the database's role catalogue, following the exact pattern
-- migration 039 (pos_cashier/pos_supervisor introduction) already
-- established. pos.report.generate (draft/review) and pos.report.finalize
-- (lock) are granted to two DIFFERENT existing role tiers on purpose --
-- pos_supervisor generates/reviews, pos_manager finalizes -- mirroring the
-- accountant/finance_manager journal create/approve split and the
-- pos_return_create_approve separation migration 039 already introduced.

WITH seed(role_slug,permission_key) AS (
  VALUES
    ('pos_supervisor','pos.report.generate'),
    ('pos_supervisor','pos.report.view'),
    ('pos_manager','pos.report.finalize'),
    ('pos_manager','pos.report.view')
)
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,s.permission_key
FROM seed s
JOIN roles r ON r.slug=s.role_slug AND r.is_system=true
ON CONFLICT DO NOTHING;

COMMIT;
