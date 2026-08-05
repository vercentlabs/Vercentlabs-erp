import { ACCOUNTING_PERMISSIONS } from "./accounting.js";
import { BILLING_PERMISSIONS } from "./billing.js";
import { CRM_PERMISSIONS } from "./crm.js";
import { SALES_PERMISSIONS } from "./sales.js";
import { PROCUREMENT_PERMISSIONS } from "./procurement.js";
import { STOCK_PERMISSIONS } from "./stock.js";
import { MANUFACTURING_PERMISSIONS } from "./manufacturing.js";
import { PROJECT_PERMISSIONS } from "./projects.js";
import { ASSET_PERMISSIONS } from "./assets.js";
import { POS_PERMISSIONS } from "./point-of-sale.js";
import { QUALITY_PERMISSIONS } from "./quality.js";
import { SUPPORT_PERMISSIONS } from "./support.js";
import { HR_PAYROLL_PERMISSIONS } from "./hr-payroll.js";

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
  rolesView: "roles.view",
  rolesManage: "roles.manage",
  rolesAssign: "roles.assign",
  accessSodOverride: "access.sod.override",
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
  ...Object.values(ACCOUNTING_PERMISSIONS),
  ...Object.values(SALES_PERMISSIONS),
  ...Object.values(PROCUREMENT_PERMISSIONS),
  ...Object.values(STOCK_PERMISSIONS),
  ...Object.values(MANUFACTURING_PERMISSIONS),
  ...Object.values(PROJECT_PERMISSIONS),
  ...Object.values(ASSET_PERMISSIONS),
  ...Object.values(POS_PERMISSIONS),
  ...Object.values(QUALITY_PERMISSIONS),
  ...Object.values(SUPPORT_PERMISSIONS),
  ...Object.values(HR_PAYROLL_PERMISSIONS),
  ...Object.values(BILLING_PERMISSIONS),
]);

export function buildPermissionKey({ scope = "tenant", resource, action }) {
  return `${scope}:${resource}:${action}`;
}
export * from "./accounting.js";
export * from "./crm.js";
export * from "./sales.js";
export * from "./procurement.js";
export * from "./billing.js";
export * from "./stock.js";
export * from "./manufacturing.js";
export * from "./projects.js";
export * from "./assets.js";
export * from "./point-of-sale.js";
export * from "./quality.js";
export * from "./support.js";
export * from "./hr-payroll.js";
