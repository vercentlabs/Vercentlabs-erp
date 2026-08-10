BEGIN;

-- Prompt 9 (Governance Foundation: Billing, Audit Logs, Compliance).
--
-- Adds the single new permission the Compliance workspace needs:
-- "compliance.view" gates read access to the new cross-module /compliance
-- surface (Overview, Retention, Consent, Privacy Requests, Data
-- Governance) — distinct from the existing crm.privacy.manage permission,
-- which continues to gate the underlying CRM privacy/retention/consent
-- mutations (execute a privacy request, edit a retention policy) that
-- Compliance's pages read from and link into, unchanged. See
-- docs/implementation/ERP_GOVERNANCE_009.md Section 18.
--
-- packages/permissions/src/index.js's CORE_PERMISSIONS is the canonical
-- TypeScript source (new organizations get this automatically via
-- ROLE_TEMPLATES); this migration performs the equivalent backfill for
-- every organization that already exists, following exactly the same
-- pattern established by migration 018's original seed and migration
-- 027's role-catalogue backfill: (1) register the key in the global
-- `permissions` table, (2) grant it to every existing organization's
-- system role rows that should hold it.
--
-- Granted to: organization_owner and system_administrator (already
-- implicitly correct via ALL_PERMISSIONS, granted explicitly here too so
-- this migration is self-contained and doesn't depend on ALL_PERMISSIONS'
-- exact current contents), company_administrator (same reasoning), and
-- auditor (explicit addition — Auditor is Read-only governance/audit
-- access and compliance visibility is squarely inside that role's stated
-- purpose; it deliberately does NOT get crm.privacy.manage, matching
-- apps/web/tests/enterprise-rbac.test.mjs's existing least-privilege
-- assertion, which this migration does not touch).

INSERT INTO permissions (key, name, category, description) VALUES
  ('compliance.view', 'View compliance workspace', 'Compliance', 'View the cross-module Compliance overview, retention configuration, consent records and privacy request status.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'compliance.view'
FROM roles r
WHERE r.is_system = true
  AND r.slug IN ('organization_owner', 'system_administrator', 'company_administrator', 'auditor')
ON CONFLICT DO NOTHING;

COMMIT;
