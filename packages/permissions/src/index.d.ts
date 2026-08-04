export * from "./accounting.js";
export const BUSINESS_DATA_PERMISSIONS: Readonly<{
  view: "business_data.view";
  partiesManage: "parties.manage";
  itemsManage: "items.manage";
  inventorySetupManage: "inventory_setup.manage";
  financeSetupManage: "finance_setup.manage";
  import: "business_data.import";
}>;

export const ALL_PERMISSIONS: readonly string[];

export function buildPermissionKey(input: {
  scope?: string;
  resource: string;
  action: string;
}): string;
export * from "./crm.js";
export * from "./billing.js";
export const CORE_PERMISSIONS: Readonly<{
  workspaceView: "workspace.view";
  organizationManage: "organization.manage";
  companyManage: "company.manage";
  branchManage: "branch.manage";
  departmentManage: "department.manage";
  costCenterManage: "cost_center.manage";
  teamManage: "team.manage";
  usersView: "users.view";
  usersManage: "users.manage";
  rolesView: "roles.view";
  rolesManage: "roles.manage";
  rolesAssign: "roles.assign";
  accessSodOverride: "access.sod.override";
  auditView: "audit.view";
  notificationsView: "notifications.view";
  modulesManage: "modules.manage";
  numberingManage: "numbering.manage";
  approvalsManage: "approvals.manage";
  profileManage: "profile.manage";
  sessionsManage: "sessions.manage";
}>;
export * from "./sales.js";

export * from "./procurement.js";
