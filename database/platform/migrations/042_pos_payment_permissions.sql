BEGIN;

-- F283 (card) / F284 (UPI) / F285 (split tender) / F286 (multiple payment
-- methods): two new POS permissions -- pos.payment.refund (issue a refund
-- against a captured payment, routed back to its original tender) and
-- pos.payment.override (request a manual force-capture override when a
-- provider is unreachable; deciding one still goes through the real
-- maker-checker engine in services/api/src/core/approvals.js, which
-- blocks the requester from also being the approver -- see
-- packages/permissions/src/roles.js's comment on POS_PERMISSIONS.
-- paymentOverride for why this is a single permission with per-record
-- separation-of-duties, the same shape pos.discount.apply already uses,
-- rather than a second "approve" permission).
INSERT INTO permissions (key, name, category, description) VALUES
  ('pos.payment.refund', 'Refund a POS payment', 'Point of Sale', 'Issue a refund against a captured POS payment, routed back to its original tender method.'),
  ('pos.payment.override', 'Override a POS payment', 'Point of Sale', 'Request (or, held by a different identity, decide) a manual force-capture override for a POS payment a provider could not confirm.')
ON CONFLICT (key) DO UPDATE SET
  name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

-- packages/permissions/src/roles.js is the authoritative, tested source
-- (see migration 039's comment for the same point) -- this migration is a
-- point-in-time copy of that source's pos_manager/pos_supervisor grants
-- into the database's role catalogue, plus the standing full-access
-- system roles that every other permission-adding migration in this
-- catalogue also extends (e.g. 037_crm_account_governance_permissions.sql).
WITH seed(role_slug,permission_key) AS (
  VALUES
    ('pos_manager','pos.payment.refund'),
    ('pos_manager','pos.payment.override'),
    ('pos_supervisor','pos.payment.refund'),
    ('organization_owner','pos.payment.refund'),
    ('organization_owner','pos.payment.override'),
    ('system_administrator','pos.payment.refund'),
    ('system_administrator','pos.payment.override'),
    ('company_administrator','pos.payment.refund'),
    ('company_administrator','pos.payment.override')
)
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,s.permission_key
FROM seed s
JOIN roles r ON r.slug=s.role_slug AND r.is_system=true
ON CONFLICT DO NOTHING;

COMMIT;
