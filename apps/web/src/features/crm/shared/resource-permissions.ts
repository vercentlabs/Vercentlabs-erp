import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

// Shared by both generic /api/crm/[resource] route files. Only covers
// resources actually reachable through UI built so far. Every other one
// of the 47 CRM_RESOURCE_KEYS falls back to requiring only module access
// (crm.view) until it gets its own UI and this map is extended for it —
// a known, recorded scope boundary (see CRM_CLEAN_REBUILD_REGISTER.md),
// not a silent gap: closing "any authenticated org member can call any
// CRM mutation with zero permission floor" (the actual severe bug found
// in an earlier checkpoint) does not require finishing a full 47-resource
// permission audit in one pass. Extend this map, not each route file
// individually, whenever a new generic-resource-backed screen ships.
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
};
