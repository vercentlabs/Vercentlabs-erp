import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

// Shared by both generic /api/crm/[resource] route files, via
// assertCrmResourceMutationPermission() (crm-context.ts) — NOT read directly by the
// routes any more. A resource with an entry here requires that permission
// to mutate; a resource with none is denied by default (see
// assertCrmResourceMutationPermission and SELF_SCOPED_CRM_RESOURCES below) rather
// than silently falling back to module-access-only, which was a real,
// closed gap (ERP_COMPLETION_GAP_REGISTER.csv, SEC-CRM-001): any CRM
// member with only crm.view could mutate any of the ~40 CRM_RESOURCE_KEYS
// entries missing from this map, including ones with no UI at all, by
// calling the generic endpoint directly. Extend this map, not each route
// file individually, whenever a new generic-resource-backed screen ships
// a real manage action; do not add a resource here "just to be safe" —
// deny-by-default is now the correct default for anything unmapped.
// Resources deliberately exempt from RESOURCE_MANAGE_PERMISSIONS because an
// organizational "manage" tier doesn't apply to them at all — their own
// domain/SQL layer already enforces a stricter, per-user scope instead of
// module access being the correct floor. Keep this list short and each
// entry justified; it is a documented exception, not an escape hatch.
// Currently empty: saved views (its only entry) were removed in migration 179.
const SELF_SCOPED_CRM_RESOURCES = new Set<string>([]);

const RESOURCE_MANAGE_PERMISSIONS: Partial<Record<string, string>> = {
  leads: CRM_PERMISSIONS.leadsEdit,
  opportunities: CRM_PERMISSIONS.opportunitiesManage,
  // Teams and their members are managed with crm.teams.manage (Settings → Teams).
  "sales-teams": CRM_PERMISSIONS.teamsManage,
  "sales-team-members": CRM_PERMISSIONS.teamsManage,
  tags: CRM_PERMISSIONS.settingsManage,
  pipelines: CRM_PERMISSIONS.settingsManage,
  // F002 AccountPlanPanel/stakeholder UI (not a redirect-governed resource
  // like "stages", so without an entry here it would fall through to
  // module-access-only).
  "account-plans": CRM_PERMISSIONS.accountsEdit,
  "account-stakeholders": CRM_PERMISSIONS.accountsEdit,
  // F025 — forecast-periods is admin-configured; forecast-
  // submissions is rep-authored (own Opportunity-derived numbers), so it
  // reuses crm.opportunities.manage rather than crm.settings.manage —
  // this resource already has ownerField scoping (see its own registry
  // comment), so a plain manage permission plus that scoping is the
  // correct floor for a rep submitting their own forecast.
  // Period governance and submission are explicit forecast
  // permissions (submissions are also governed by the forecast service's
  // lifecycle and immutability rules).
  "forecast-periods": CRM_PERMISSIONS.forecastManage,
  "forecast-submissions": CRM_PERMISSIONS.forecastSubmit,
  // Consent events: an immutable evidence log that outbound email checks
  // before contacting someone; created only, never edited (record-policy.js).
  "consent-events": CRM_PERMISSIONS.privacyManage,
};

export type CrmMutationPermissionResolution =
  | { kind: "self-scoped" }
  | { kind: "requires-permission"; permission: string }
  | { kind: "denied" };

// Pure decision logic (no DB, no server-only import) so it's directly
// unit-testable — crm-context.ts's assertCrmResourceMutationPermission() is a thin
// wrapper (workspaceRoute has already run the module-access check) that throws for
// "denied", but that wrapper can't itself be imported by a plain
// `node --test` file (it starts with `import "server-only"`, which throws
// unconditionally outside Next's server runtime). This function is the one
// place the actual deny-by-default policy lives, and what
// resource-permissions.test.ts exercises directly.
export function resolveCrmMutationPermission(
  resource: string,
): CrmMutationPermissionResolution {
  const permission = RESOURCE_MANAGE_PERMISSIONS[resource];
  if (permission) return { kind: "requires-permission", permission };
  if (SELF_SCOPED_CRM_RESOURCES.has(resource)) return { kind: "self-scoped" };
  return { kind: "denied" };
}
