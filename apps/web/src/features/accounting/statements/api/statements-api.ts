"use client";

// Financial statements (Finance MVP F8): the client of /api/accounting/financial-statements/[kind].
import { AccountingApiError } from "@/features/accounting/shared/client";

async function call<T>(path: string): Promise<T> {
  const response = await fetch(`/api/accounting/financial-statements${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);

export type StatementPeriods = { today: string; current: FinancialYear | null; years: FinancialYear[] };
export type FinancialYear = { id: string; name: string; start: string; end: string; status: string };
type Checked = { balanced: boolean; exceptions: string[] };
export type TrialBalance = Checked & {
  from: string; to: string;
  rows: Array<{ accountId: string; code: string; name: string; accountClass: string; accountType: string; group: string | null; openingDebit: number; openingCredit: number;
    debit: number; credit: number; closingDebit: number; closingCredit: number }>;
  totals: { openingDebit: number; openingCredit: number; debit: number; credit: number; closingDebit: number; closingCredit: number };
};
export type StatementLine = { accountId: string; code: string; name: string; amount: number; compare: number | null };
export type ProfitAndLoss = Checked & {
  from: string; to: string; compare: { from: string; to: string; mode: string } | null;
  sections: Array<{ key: string; label: string; total: number; compareTotal: number | null; lines: StatementLine[] }>;
  grossProfit: number; operatingProfit: number; netProfit: number; compareTotals: { grossProfit: number; operatingProfit: number; netProfit: number } | null;
};
export type BalanceSheetGroup = { key: string; label: string; total: number; compareTotal: number | null; lines: StatementLine[] };
export type BalanceSheet = Checked & {
  asOf: string; compareTo: string | null; year: FinancialYear | null; assets: BalanceSheetGroup[]; liabilities: BalanceSheetGroup[]; suspense: BalanceSheetGroup | null;
  equity: BalanceSheetGroup & { extras: Array<{ key: string; label: string; amount: number; compare: number | null }> };
  totals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number };
  compareTotals: { assets: number; liabilities: number; equity: number; liabilitiesAndEquity: number } | null;
};
export type CashFlowItem = { key: string; label: string; amount: number };
export type CashFlow = Checked & {
  from: string; to: string; operating: { netProfit: number; items: CashFlowItem[]; total: number }; investing: { items: CashFlowItem[]; total: number };
  financing: { items: CashFlowItem[]; total: number }; netChange: number; openingCash: number; closingCash: number;
  cashAccounts: Array<{ accountId: string; code: string; name: string; opening: number; closing: number }>;
};

export const statementPeriods = () => call<{ periods: StatementPeriods }>("/periods").then((r) => r.periods);
export const trialBalance = (filters: { from?: string; to?: string; showZero?: string }) => call<{ statement: TrialBalance }>(`/trial-balance${qs(filters)}`).then((r) => r.statement);
export const profitAndLoss = (filters: { from?: string; to?: string; compare?: string }) => call<{ statement: ProfitAndLoss }>(`/profit-and-loss${qs(filters)}`).then((r) => r.statement);
export const balanceSheet = (filters: { asOf?: string; compareTo?: string }) => call<{ statement: BalanceSheet }>(`/balance-sheet${qs(filters)}`).then((r) => r.statement);
export const cashFlow = (filters: { from?: string; to?: string }) => call<{ statement: CashFlow }>(`/cash-flow${qs(filters)}`).then((r) => r.statement);

// Amounts: Indian grouping, negatives in brackets (as statements print them), zero as a dash.
export const amount = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "";
  if (Math.abs(value) < 0.005) return "—";
  const text = Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${text})` : text;
};

// A CSV of rows, downloaded in the browser (Excel opens it; a leading = + - @ is neutralised against formula injection).
export function downloadCsv(fileName: string, rows: Array<Array<string | number | null>>) {
  const escape = (value: string | number | null) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "number" ? value.toFixed(2) : /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const blob = new Blob([`﻿${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
