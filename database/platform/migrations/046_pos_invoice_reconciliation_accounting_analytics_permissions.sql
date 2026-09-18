BEGIN;

-- F290 (invoice generation) / F304 (payment reconciliation) / F305 (POS
-- accounting posting) / F307 (POS analytics). Same pattern migrations 023/
-- 027/039/040/043/044/045 already established for this module.
--
-- pos.invoice.generate/.view: producing/viewing a formal tax invoice for a
-- completed sale is a normal checkout-adjacent action (like a receipt
-- reprint), not a supervisor override -- granted at the same tier as
-- pos.sale.create.
--
-- pos.reconciliation.manage vs .approve: a genuine maker-checker split,
-- mirroring pos.report.generate/.finalize exactly (see the
-- pos_day_end_generate_finalize SoD conflict) -- pos_supervisor
-- imports/matches settlement evidence and generates the reconciliation,
-- pos_manager is the separate authority that resolves a variance
-- exception. The blocking pos_reconciliation_manage_approve SoD conflict
-- (packages/permissions/src/roles.js) prevents one role holding both.
--
-- pos.accounting.post: triggering/retrying the GL posting for a completed
-- sale/return is a sensitive financial-system action, at the same tier as
-- pos.settings.manage -- pos_manager only.
--
-- pos.analytics.view: granted to the same tier that already holds
-- pos.reports.view (pos_supervisor, pos_manager).
INSERT INTO permissions (key,name,category,description) VALUES
('pos.invoice.generate','Generate POS invoice','Point of Sale','Generate a formal tax invoice document for a completed POS sale'),
('pos.invoice.view','View POS invoices','Point of Sale','View or reprint an already-generated POS invoice'),
('pos.reconciliation.manage','Manage POS payment reconciliation','Point of Sale','Import settlement evidence and generate/match POS payment reconciliation'),
('pos.reconciliation.approve','Approve POS reconciliation exceptions','Point of Sale','Investigate and resolve a POS payment reconciliation variance'),
('pos.reconciliation.view','View POS payment reconciliation','Point of Sale','View POS payment reconciliation records and exceptions'),
('pos.accounting.post','Post POS transactions to accounting','Point of Sale','Trigger or retry posting a completed POS sale/return to the Accounting general ledger'),
('pos.accounting.view','View POS accounting posting status','Point of Sale','View POS accounting posting status, including failed/pending postings'),
('pos.analytics.view','View POS analytics','Point of Sale','View POS sales, tender, return, reconciliation and accounting-posting analytics')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('pos.invoice.generate'),
  ('pos.invoice.view')
) AS p(permission_key)
WHERE r.is_system=true AND r.template_key IN ('pos_cashier','pos_supervisor','pos_manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('pos.reconciliation.manage'),
  ('pos.reconciliation.view'),
  ('pos.analytics.view')
) AS p(permission_key)
WHERE r.is_system=true AND r.template_key='pos_supervisor'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN (VALUES
  ('pos.reconciliation.approve'),
  ('pos.reconciliation.view'),
  ('pos.accounting.post'),
  ('pos.accounting.view'),
  ('pos.analytics.view')
) AS p(permission_key)
WHERE r.is_system=true AND r.template_key='pos_manager'
ON CONFLICT DO NOTHING;

COMMIT;
