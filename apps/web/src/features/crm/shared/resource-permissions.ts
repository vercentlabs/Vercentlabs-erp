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
};
