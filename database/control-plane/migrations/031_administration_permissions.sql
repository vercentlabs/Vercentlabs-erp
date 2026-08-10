BEGIN;

-- Prompt 10 (Administration Foundation: Workspace Settings, Automation,
-- Reports & Analytics, Integrations, Data Management, Security).
--
-- Three new minimal view-only permissions gate the new shared-platform
-- Administration workspaces this prompt adds. Each is genuinely new — the
-- permission catalogue had no equivalent capability for any of the three
-- domains (confirmed by direct audit before this migration was written).
-- No corresponding "manage" permission was added for any of them: every
-- mutation these new workspaces perform (creating a CRM webhook
-- subscription, running a CRM import, etc.) continues to be gated by the
-- existing, unmodified permission that already protected it — these three
-- keys only gate READ access to the new discovery/overview surfaces.
--
-- Reports & Analytics deliberately has no new permission at all — its
-- workspace aggregates only report destinations the caller's own existing
-- per-report permission (crm.reports.view, sales.reports.view, etc.)
-- already allows, matching Prompt 8's My Work precedent (no redundant
-- blanket gate on top of per-source checks).
--
-- Same pattern as migration 030 (compliance.view): register the key in
-- the global `permissions` table, then grant it directly to every
-- existing organization's already-materialized system-role rows, since a
-- TypeScript-only change (access-control.ts's ROLE_TEMPLATES) only takes
-- effect for organizations created after this migration ships.

INSERT INTO permissions (key, name, category, description) VALUES
  ('automation.view', 'View automation workspace', 'Automation', 'View automation rule status and execution history.'),
  ('integrations.view', 'View integrations workspace', 'Integrations', 'View configured integrations, webhook subscriptions and delivery-queue status.'),
  ('data_management.view', 'View data management workspace', 'Data Management', 'View import/export, bulk-update and data-operations tooling.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, permission_key
FROM roles r
CROSS JOIN (VALUES ('automation.view'), ('integrations.view'), ('data_management.view')) AS p(permission_key)
WHERE r.is_system = true
  AND r.slug IN ('organization_owner', 'system_administrator', 'company_administrator', 'auditor')
ON CONFLICT DO NOTHING;

-- Automation today is a CRM-only capability (CRM automation rules and
-- their execution history) — CRM Administrator additionally gets
-- automation.view, matching the module it actually governs.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'automation.view'
FROM roles r
WHERE r.is_system = true AND r.slug = 'crm_administrator'
ON CONFLICT DO NOTHING;

COMMIT;
