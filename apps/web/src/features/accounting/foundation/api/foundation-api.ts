"use client";

// Finance foundation (MVP F1): the client of /api/accounting/{chart, fiscal-years, fiscal-periods}. Errors arrive as AccountingApiError with the
// domain's plain-language message and, for a form, the field it is about.
import { AccountingApiError } from "@/features/accounting/shared/client";

export class FoundationApiError extends AccountingApiError {
  constructor(message: string, status: number, code?: string, public readonly field?: string) {
    super(message, status, code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false)
    throw new FoundationApiError(payload.message || "The request could not be completed.", response.status, payload.code, typeof payload.field === "string" ? payload.field : undefined);
  return payload as T;
}
const send = <T>(method: string, path: string, body: unknown = {}) => call<T>(path, { method, body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);
export const errorField = (error: unknown) => (error instanceof FoundationApiError ? error.field : undefined);

// ------------------------------------------------------------------ chart of accounts
export type AccountClass = "asset" | "liability" | "equity" | "revenue" | "expense";
export type ChartAccount = {
  id: string; ledgerId: string; parentId: string | null; code: string; name: string; accountClass: AccountClass; accountType: string; accountTypeLabel: string;
  normalBalance: "debit" | "credit"; isGroup: boolean; allowManualPosting: boolean; reconciliationRequired: boolean; controlKind: string | null; controlLabel: string | null;
  manualPostingLocked: boolean; currencyCode: string | null; cashFlowCategory: string | null; status: "active" | "inactive"; updatedAt: string;
  debit: number; credit: number; balance: number; postingCount: number; mappings: string[]; depth: number; childCount: number;
};
export type ChartAccountInput = {
  code?: string; name?: string; accountClass?: AccountClass; accountType?: string; isGroup?: boolean; parentId?: string | null; allowManualPosting?: boolean;
  reconciliationRequired?: boolean; cashFlowCategory?: string | null; expectedUpdatedAt?: string;
};
export type ControlCheck = { kind: string; label: string; ledger: number; subledger: number; subledgerLabel: string; difference: number; agrees: boolean };

export const listChart = () => call<{ chart: { accounts: ChartAccount[] } }>("/chart").then((r) => r.chart.accounts);
export const createAccount = (input: ChartAccountInput) => send<{ account: ChartAccount }>("POST", "/chart", input).then((r) => r.account);
export const updateAccount = (id: string, input: ChartAccountInput) => send<{ account: ChartAccount }>("PATCH", `/chart/${id}`, input).then((r) => r.account);
export const setAccountStatus = (id: string, status: "active" | "inactive") => send<{ account: ChartAccount }>("POST", `/chart/${id}/status`, { status }).then((r) => r.account);
export const deleteAccount = (id: string) => send<{ result: { deleted: true } }>("DELETE", `/chart/${id}`);
export const controlCheck = () => call<{ checks: ControlCheck[] }>("/chart/control-check").then((r) => r.checks);

// What each class may hold (mirrors chart-rules.js; the server is the authority).
export const CLASSES: Array<{ code: AccountClass; label: string; normal: "debit" | "credit" }> = [
  { code: "asset", label: "Assets", normal: "debit" }, { code: "liability", label: "Liabilities", normal: "credit" }, { code: "equity", label: "Equity", normal: "credit" },
  { code: "revenue", label: "Revenue", normal: "credit" }, { code: "expense", label: "Expenses", normal: "debit" },
];
export const TYPES_BY_CLASS: Record<AccountClass, Array<[string, string]>> = {
  asset: [["bank", "Bank"], ["cash", "Cash"], ["receivable", "Accounts receivable"], ["inventory", "Inventory"], ["fixed_asset", "Fixed asset"],
    ["accumulated_depreciation", "Accumulated depreciation (contra asset)"], ["tax_input", "Input tax"], ["current_asset", "Other current asset"],
    ["non_current_asset", "Other non-current asset"], ["suspense", "Suspense / clearing"]],
  liability: [["payable", "Accounts payable"], ["tax_output", "Output tax"], ["current_liability", "Current liability"], ["non_current_liability", "Long-term liability"],
    ["suspense", "Suspense / clearing"]],
  equity: [["equity", "Equity"], ["retained_earnings", "Retained earnings"]],
  revenue: [["revenue", "Revenue"], ["other_income", "Other income"], ["fx_gain", "Exchange gain"]],
  expense: [["cogs", "Cost of goods sold"], ["expense", "Operating expense"], ["other_expense", "Other expense / loss"], ["fx_loss", "Exchange loss"], ["rounding", "Rounding"]],
};
export const CONTROL_TYPES = new Set(["receivable", "payable", "inventory", "tax_input", "tax_output"]);
export const CASH_FLOW: Array<[string, string]> = [["operating", "Operating"], ["investing", "Investing"], ["financing", "Financing"], ["cash", "Cash and equivalents"], ["non_cash", "Non-cash"]];

// ------------------------------------------------------------------ fiscal years and periods
export type PeriodStatus = "open" | "soft_closed" | "closed" | "locked";
export type FiscalPeriod = {
  id: string; name: string; number: number | null; type: "standard" | "adjustment" | string; startDate: string; endDate: string; status: PeriodStatus;
  statusKey: string; statusLabel: string; journalCount: number; note: string | null;
};
export type FiscalYear = {
  id: string; code: string; name: string; startDate: string; endDate: string; status: string; current: boolean; periods: FiscalPeriod[]; counts: Record<PeriodStatus, number>;
};
export const listFiscalYears = () => call<{ years: FiscalYear[] }>("/fiscal-years").then((r) => r.years);
export const createFiscalYear = (input: { startDate?: string; withAdjustmentPeriod?: boolean }) => send<{ year: FiscalYear }>("POST", "/fiscal-years", input).then((r) => r.year);
export const setPeriodReview = (id: string, review: boolean, note?: string) =>
  send<{ period: FiscalPeriod }>("POST", `/fiscal-periods/${id}/review`, { review, note }).then((r) => r.period);
