import { BILLING_PERMISSIONS } from "./billing.js";
import { CRM_PERMISSIONS } from "./crm.js";

export const CORE_PERMISSIONS = Object.freeze({
  workspaceView: "workspace.view",
  organizationManage: "organization.manage",
  companyManage: "company.manage",
  branchManage: "branch.manage",
  departmentManage: "department.manage",
  costCenterManage: "cost_center.manage",
  teamManage: "team.manage",
  usersView: "users.view",
  usersManage: "users.manage",
  rolesManage: "roles.manage",
  auditView: "audit.view",
  notificationsView: "notifications.view",
  modulesManage: "modules.manage",
  numberingManage: "numbering.manage",
  approvalsManage: "approvals.manage",
  profileManage: "profile.manage",
  sessionsManage: "sessions.manage",
});

export const BUSINESS_DATA_PERMISSIONS = Object.freeze({
  view: "business_data.view",
  partiesManage: "parties.manage",
  itemsManage: "items.manage",
  inventorySetupManage: "inventory_setup.manage",
  financeSetupManage: "finance_setup.manage",
  import: "business_data.import",
});

export const ALL_PERMISSIONS = Object.freeze([
  ...Object.values(CORE_PERMISSIONS),
  ...Object.values(BUSINESS_DATA_PERMISSIONS),
  ...Object.values(CRM_PERMISSIONS),
  ...Object.values(BILLING_PERMISSIONS),
]);

export function buildPermissionKey({ scope = "tenant", resource, action }) {
  return `${scope}:${resource}:${action}`;
}
export * from "./crm.js";
export * from "./billing.js";
