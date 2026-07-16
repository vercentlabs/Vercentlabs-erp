export const BUSINESS_DATA_PERMISSIONS: Readonly<{
  view: "business_data.view";
  partiesManage: "parties.manage";
  itemsManage: "items.manage";
  inventorySetupManage: "inventory_setup.manage";
  financeSetupManage: "finance_setup.manage";
  import: "business_data.import";
}>;

export function buildPermissionKey(input: {
  scope?: string;
  resource: string;
  action: string;
}): string;
export * from "./crm.js";
export * from "./billing.js";
