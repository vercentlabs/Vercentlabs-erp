BEGIN;

-- F297/F298 (offline POS workspace + offline-to-online sync). Draining a
-- device's own local queue and reviewing/resolving a conflict another
-- device's sync produced are two different privilege levels — mirroring
-- the pos.return.create/pos.return.approve split migration 039 already
-- established — so this registers two new permissions rather than
-- overloading pos.settings.manage (offline sync/resolution is its own
-- capability area, not general POS configuration).
INSERT INTO permissions (key,name,category,description) VALUES
('pos.offline.sync','Sync offline POS sales','Point of Sale','Drain a device''s own queued offline sales against the server once back online'),
('pos.offline.resolve','Resolve offline sync conflicts','Point of Sale','View and resolve offline-sync conflicts (price/stock/shift divergence) for any device')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

-- packages/permissions/src/roles.js is the authoritative, tested source
-- (packages/permissions/tests/roles.test.mjs) — this is a point-in-time
-- copy of that source into the database's role catalogue for every
-- existing organization, following the exact pattern migrations 027/030/039
-- already established.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'pos.offline.sync'
FROM roles r
WHERE r.is_system = true AND r.template_key IN ('pos_cashier','pos_supervisor')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'pos.offline.resolve'
FROM roles r
WHERE r.is_system = true AND r.template_key IN ('pos_supervisor','pos_manager')
ON CONFLICT DO NOTHING;

COMMIT;
