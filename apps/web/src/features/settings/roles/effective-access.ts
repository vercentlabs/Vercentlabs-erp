import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

// What a user can actually do once roles are combined. Session permissions
// are the UNION of every active role (services/api/src/core/session.js), so
// this summary mirrors that server rule exactly — never the primary role
// alone. Only for display; every decision is still made on the server.

type RoleLike = { slug: string; permission_keys: string[] };

export type EffectiveAccessSummary = {
  permissionCount: number;
  crmRecordScope: "all" | "team" | "none";
  // Resource-specific widening on top of own/team scope (crm-access-scope.js).
  wideAccess: string[];
  highRisk: string[];
};

const HIGH_RISK: ReadonlyArray<[string, string]> = [
  [CRM_PERMISSIONS.leadsViewSensitive, "Sensitive lead details"],
  [CRM_PERMISSIONS.contactsViewSensitive, "Sensitive contact details"],
  [CRM_PERMISSIONS.accountsViewSensitive, "Sensitive account details (GSTIN, PAN)"],
  [CRM_PERMISSIONS.export, "Export CRM data"],
  [CRM_PERMISSIONS.import, "Import CRM data"],
  [CRM_PERMISSIONS.settingsManage, "Change CRM settings"],
  [CRM_PERMISSIONS.privacyManage, "Run privacy requests"],
];

export function summarizeEffectiveAccess(roles: RoleLike[]): EffectiveAccessSummary {
  const owner = roles.some((role) => role.slug === "organization_owner");
  const permissions = new Set(roles.flatMap((role) => role.permission_keys));
  const has = (key: string) => owner || permissions.has(key);
  const umbrella = has(CRM_PERMISSIONS.recordsViewAll);
  const wideAccess = umbrella
    ? []
    : [
        ...(has(CRM_PERMISSIONS.leadsViewAll) ? ["All Leads"] : []),
        ...(has(CRM_PERMISSIONS.customersViewAll) ? ["All customer Accounts, their Contacts and customer Activities"] : []),
        ...(has(CRM_PERMISSIONS.partnersManage) ? ["Partner-registered Leads and Opportunities, and partner Accounts"] : []),
      ];
  const highRisk = [
    ...(umbrella ? ["All CRM records in their companies"] : []),
    ...wideAccess,
    ...HIGH_RISK.filter(([key]) => has(key)).map(([, label]) => label),
  ];
  return {
    permissionCount: permissions.size,
    crmRecordScope: !has(CRM_PERMISSIONS.view) ? "none" : has(CRM_PERMISSIONS.recordsViewAll) ? "all" : "team",
    highRisk,
    wideAccess,
  };
}

export const CRM_RECORD_SCOPE_LABEL: Record<EffectiveAccessSummary["crmRecordScope"], string> = {
  all: "All CRM records in their companies",
  team: "Their own CRM records, their sales team's (if they manage one), and unassigned records",
  none: "No CRM access",
};
