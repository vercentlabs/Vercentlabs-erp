import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

// Shared by both generic /api/crm/[resource] route files, via
// requireCrmMutationAccess() (crm-context.ts) — NOT read directly by the
// routes any more. A resource with an entry here requires that permission
// to mutate; a resource with none is denied by default (see
// requireCrmMutationAccess and SELF_SCOPED_CRM_RESOURCES below) rather
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
export const SELF_SCOPED_CRM_RESOURCES = new Set<string>([
  // tenant.crm_saved_views: record-policy.js's recordScope() hard-scopes
  // every read/write to `record.user_id = context.userId`, and
  // resource-mutation-service.js forces userId=context.userId on create and
  // strips any client-supplied userId on update — inherently a personal
  // resource, any CRM user manages only their own saved views, no
  // organizational permission tier applies. See saved-views-api.ts.
  "saved-views",
]);

export const RESOURCE_MANAGE_PERMISSIONS: Partial<Record<string, string>> = {
  leads: CRM_PERMISSIONS.leadsManage,
  opportunities: CRM_PERMISSIONS.opportunitiesManage,
  "sales-teams": CRM_PERMISSIONS.settingsManage,
  "sales-team-members": CRM_PERMISSIONS.settingsManage,
  territories: CRM_PERMISSIONS.settingsManage,
  "territory-assignments": CRM_PERMISSIONS.settingsManage,
  tags: CRM_PERMISSIONS.settingsManage,
  "custom-object-definitions": CRM_PERMISSIONS.settingsManage,
  "custom-field-definitions": CRM_PERMISSIONS.settingsManage,
  "lost-reasons": CRM_PERMISSIONS.settingsManage,
  pipelines: CRM_PERMISSIONS.settingsManage,
  // Tranche E (F002) shipped AccountPlanPanel/stakeholder UI reachable by
  // any org member with crm.view — this map was not extended at the time,
  // a real gap (not a redirect-governed resource like "stages", so it
  // silently fell through to module-access-only). Fixed here, retroactively,
  // per this file's own documented policy.
  "account-plans": CRM_PERMISSIONS.accountsManage,
  "account-stakeholders": CRM_PERMISSIONS.accountsManage,
  // Tranche I (F006/F027) — qualification-criteria/playbooks setup UI.
  "qualification-criteria": CRM_PERMISSIONS.settingsManage,
  playbooks: CRM_PERMISSIONS.settingsManage,
  // Tranche K (F025) — forecast-periods is admin-configured; forecast-
  // submissions is rep-authored (own Opportunity-derived numbers), so it
  // reuses crm.opportunities.manage rather than crm.settings.manage —
  // this resource already has ownerField scoping (see its own registry
  // comment), so a plain manage permission plus that scoping is the
  // correct floor for a rep submitting their own forecast.
  "forecast-periods": CRM_PERMISSIONS.settingsManage,
  "forecast-submissions": CRM_PERMISSIONS.opportunitiesManage,
  // Stage A2 §5 (F014) — meeting-links config (availability/duration/
  // buffers/provider) is what a public booking page is generated from,
  // so only settings-manage should create/edit one.
  "meeting-links": CRM_PERMISSIONS.settingsManage,
  // Stage A2 §8 (F020) — quota-plans configuration (team/territory/user
  // target amounts) is a settings-manage concern, same as territories
  // themselves.
  "quota-plans": CRM_PERMISSIONS.settingsManage,
  // Consent/GDPR module — crm_consent_events (immutable evidence log) and
  // crm_privacy_requests (the DSR queue) already have a full backend
  // (account-intelligence.js's preview/executePrivacyRequest and friends)
  // and record-policy.js already governs their write shape (consent
  // events are create-only; a completed request can't be reopened), but
  // both were missing from this map — meaning any mutation against them
  // through the generic /api/crm/[resource] route silently resolved to
  // "denied" until now. crm.privacy.manage is the same permission already
  // seeded and already used to gate the "privacy" report and the Data
  // Subject Requests settings screen.
  "consent-events": CRM_PERMISSIONS.privacyManage,
  "privacy-requests": CRM_PERMISSIONS.privacyManage,
};

export type CrmMutationPermissionResolution =
  | { kind: "self-scoped" }
  | { kind: "requires-permission"; permission: string }
  | { kind: "denied" };

// Pure decision logic (no DB, no server-only import) so it's directly
// unit-testable — crm-context.ts's requireCrmMutationAccess() is a thin
// wrapper that also runs the module-access DB check and throws for
// "denied", but that wrapper can't itself be imported by a plain
// `node --test` file (it starts with `import "server-only"`, which throws
// unconditionally outside Next's server runtime). This function is the one
// place the actual deny-by-default policy lives, and what
// resource-permissions.test.ts exercises directly.
export function resolveCrmMutationPermission(resource: string): CrmMutationPermissionResolution {
  const permission = RESOURCE_MANAGE_PERMISSIONS[resource];
  if (permission) return { kind: "requires-permission", permission };
  if (SELF_SCOPED_CRM_RESOURCES.has(resource)) return { kind: "self-scoped" };
  return { kind: "denied" };
}
