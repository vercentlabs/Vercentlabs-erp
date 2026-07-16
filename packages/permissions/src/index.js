export const BUSINESS_DATA_PERMISSIONS = Object.freeze({
  view: "business_data.view",
  partiesManage: "parties.manage",
  itemsManage: "items.manage",
  inventorySetupManage: "inventory_setup.manage",
  financeSetupManage: "finance_setup.manage",
  import: "business_data.import",
});

export function buildPermissionKey({ scope = "tenant", resource, action }) {
  return `${scope}:${resource}:${action}`;
}
export * from "./crm.js";
export * from "./billing.js";
