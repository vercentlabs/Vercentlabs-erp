export declare const POS_PERMISSIONS: Readonly<Record<string, string>>;
export declare const POS_OUTLET_PERMISSIONS: Readonly<{
  view: "pos.outlets.view";
  create: "pos.outlets.create";
  edit: "pos.outlets.edit";
  status: "pos.outlets.status";
  manageInventory: "pos.outlets.manage_inventory";
  manageTax: "pos.outlets.manage_tax";
  managePayments: "pos.outlets.manage_payments";
  manageAccess: "pos.outlets.manage_access";
  viewTransactions: "pos.outlets.view_transactions";
  viewSessions: "pos.outlets.view_sessions";
  viewFinance: "pos.outlets.view_finance";
}>;
export declare const POS_TERMINAL_PERMISSIONS: Readonly<{
  view: "pos.terminals.view";
  create: "pos.terminals.create";
  edit: "pos.terminals.edit";
  status: "pos.terminals.status";
  configureInventory: "pos.terminals.configure_inventory";
  configureCash: "pos.terminals.configure_cash";
  configurePayments: "pos.terminals.configure_payments";
  configureNumbering: "pos.terminals.configure_numbering";
  configureHardware: "pos.terminals.configure_hardware";
  viewSessions: "pos.terminals.view_sessions";
  viewTransactions: "pos.terminals.view_transactions";
}>;
export declare const POS_CASHIER_PERMISSIONS: Readonly<{
  view: "pos.cashiers.view";
  create: "pos.cashiers.create";
  edit: "pos.cashiers.edit";
  status: "pos.cashiers.status";
  assignOutlets: "pos.cashiers.assign_outlets";
  viewSessions: "pos.cashiers.view_sessions";
  viewTransactions: "pos.cashiers.view_transactions";
  viewCash: "pos.cashiers.view_cash";
}>;
export declare const POS_PERMISSION_PROFILE_PERMISSIONS: Readonly<{
  view: "pos.permission_profiles.view";
  manage: "pos.permission_profiles.manage";
  status: "pos.permission_profiles.status";
  assign: "pos.permission_profiles.assign";
  configureUnlimited: "pos.permission_profiles.configure_unlimited";
  viewHistory: "pos.permission_profiles.view_history";
}>;
