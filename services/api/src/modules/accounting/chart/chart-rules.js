// Chart of Accounts rules (Finance MVP F1): which account types belong to which class, the normal balance each class takes, and which
// control accounts a sub-ledger owns. Pure: no database.

export const ACCOUNT_CLASSES = Object.freeze([
  { code: "asset", label: "Assets", normalBalance: "debit" },
  { code: "liability", label: "Liabilities", normalBalance: "credit" },
  { code: "equity", label: "Equity", normalBalance: "credit" },
  { code: "revenue", label: "Revenue", normalBalance: "credit" },
  { code: "expense", label: "Expenses", normalBalance: "debit" },
]);

// The types a posting account of each class may have ("group" is a heading of any class).
export const ACCOUNT_TYPES_BY_CLASS = Object.freeze({
  asset: ["bank", "cash", "receivable", "inventory", "fixed_asset", "accumulated_depreciation", "tax_input", "current_asset", "non_current_asset", "suspense"],
  liability: ["payable", "tax_output", "current_liability", "non_current_liability", "suspense"],
  equity: ["equity", "retained_earnings"],
  revenue: ["revenue", "other_income", "fx_gain"],
  expense: ["cogs", "expense", "other_expense", "fx_loss", "rounding"],
});

export const ACCOUNT_TYPE_LABELS = Object.freeze({
  group: "Group heading", bank: "Bank", cash: "Cash", receivable: "Accounts receivable", inventory: "Inventory", fixed_asset: "Fixed asset",
  accumulated_depreciation: "Accumulated depreciation (contra asset)", tax_input: "Input tax", current_asset: "Other current asset",
  non_current_asset: "Other non-current asset", suspense: "Suspense / clearing", payable: "Accounts payable", tax_output: "Output tax",
  current_liability: "Current liability", non_current_liability: "Long-term liability", equity: "Equity", retained_earnings: "Retained earnings",
  revenue: "Revenue", other_income: "Other income", fx_gain: "Exchange gain", cogs: "Cost of goods sold", expense: "Operating expense",
  other_expense: "Other expense / loss", fx_loss: "Exchange loss", rounding: "Rounding",
});

export const CONTROL_KINDS = Object.freeze({
  receivable: "Customer invoices and receipts", payable: "Supplier bills and payments", bank: "Bank transactions", cash: "Cash transactions",
  inventory: "Inventory movements", tax: "GST and tax documents", payroll: "Payroll",
});
// A sub-ledger's control account never takes a manual journal; banks and cash may (charges, interest).
export const NO_MANUAL_CONTROL_KINDS = Object.freeze(["receivable", "payable", "inventory", "tax", "payroll"]);

const CONTROL_KIND_BY_TYPE = Object.freeze({ receivable: "receivable", payable: "payable", bank: "bank", cash: "cash", inventory: "inventory", tax_input: "tax", tax_output: "tax" });

export function controlKindForType(accountType) {
  return CONTROL_KIND_BY_TYPE[accountType] ?? null;
}

export function normalBalanceOf(accountClass, accountType) {
  // A contra account takes the opposite balance of its class.
  if (accountType === "accumulated_depreciation") return "credit";
  return ACCOUNT_CLASSES.find((entry) => entry.code === accountClass)?.normalBalance ?? "debit";
}

export const ACCOUNT_CODE = /^[0-9A-Z][0-9A-Z.-]{0,19}$/;
