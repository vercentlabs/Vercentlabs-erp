"use client";

// Customer and supplier ledgers: aging and statements (/api/accounting/{aging, statements}).
import { AccountingApiError } from "@/features/accounting/shared/client";

async function call<T>(path: string): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
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

export type Side = "receivable" | "payable";
export type BucketKey = "notDue" | "d1_30" | "d31_60" | "d61_90" | "over90";
export type AgingRow = { partyId: string; name: string; code: string | null; credits: number; net: number; documents: number; oldestDaysPastDue: number } & Record<BucketKey, number>;
export type Aging = { side: Side; asOf: string; buckets: Array<{ key: BucketKey; label: string }>; rows: AgingRow[]; totals: Record<BucketKey | "credits" | "net", number> };
export type OpenItem = { id: string; partyId: string; kind: string; number: string; date: string; dueDate: string | null; currency: string; outstanding: number; amount: number;
  daysPastDue: number; bucket: BucketKey | "credit" };
export type Statement = {
  side: Side; from: string; to: string;
  party: { id: string; name: string; legalName: string | null; gstin: string | null; email: string | null; phone: string | null; code: string | null };
  company: { name: string; gstin: string | null; email: string | null; phone: string | null; address: string | null } | null;
  opening: number; increases: number; decreases: number; closing: number;
  lines: Array<{ date: string; journalEntryId: string; journalNumber: string; document: string; number: string; href: string | null; description: string | null; increase: number; decrease: number; balance: number }>;
  openItems: OpenItem[]; aging: Record<BucketKey | "credits", number>;
};
export const getAging = (side: Side, asOf?: string) => call<{ aging: Aging }>(`/aging/${side}${qs({ asOf })}`).then((r) => r.aging);
export const getOpenItems = (side: Side, partyId: string, asOf?: string) => call<{ items: OpenItem[] }>(`/aging/${side}/${partyId}${qs({ asOf })}`).then((r) => r.items);
export const getStatement = (side: Side, partyId: string, filters: { from?: string; to?: string }) =>
  call<{ statement: Statement }>(`/statements/${side}/${partyId}${qs(filters)}`).then((r) => r.statement);

export const money = (value: number | null | undefined) => {
  const n = Number(value ?? 0);
  if (Math.abs(n) < 0.005) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const SIDE_TEXT: Record<Side, { party: string; parties: string; ledger: string; statementPath: string; increase: string; decrease: string; owes: string; credit: string }> = {
  receivable: { party: "Customer", parties: "Customers", ledger: "Receivables", statementPath: "customer", increase: "Invoiced", decrease: "Received", owes: "owes you", credit: "Advance / credit" },
  payable: { party: "Supplier", parties: "Suppliers", ledger: "Payables", statementPath: "supplier", increase: "Billed", decrease: "Paid", owes: "you owe", credit: "Advance / credit" },
};
