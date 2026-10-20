"use client";

// Period close (Finance MVP F9): the client of /api/accounting/{period-close, fiscal-years/[id]/close}.
import { AccountingApiError } from "@/features/accounting/shared/client";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);

export type PeriodStatus = "open" | "soft_closed" | "closed" | "locked";
export type ClosePeriod = {
  id: string; name: string; number: number | null; type: string; startDate: string; endDate: string; status: PeriodStatus; statusKey: string; statusLabel: string;
  reviewStartedAt: string | null; closedAt: string | null; lockedAt: string | null; reopenedAt: string | null; reopenReason: string | null; note: string | null; closedBy?: string | null;
};
export type CloseYear = { id: string; code: string; name: string; startDate: string; endDate: string; status: string; closingJournalEntryId: string | null; closedAt: string | null;
  canClose: boolean; periods: ClosePeriod[] };
export type CloseOverview = { nextToClose: ClosePeriod | null; years: CloseYear[] };
export type CloseCheck = {
  key: string; label: string; severity: "blocking" | "warning"; count: number; clear: boolean; state: "ok" | "attention" | "acknowledged"; detail: string | null; href?: string;
  amount?: number; acknowledgement: { reason: string; at: string; by: string | null } | null;
};
export type CloseWorkspace = {
  period: ClosePeriod & { yearId: string | null; yearName: string | null; yearClosed: boolean; reviewStartedBy: string | null; closedBy: string | null; lockedBy: string | null; reopenedBy: string | null };
  previous: { id: string; name: string; status: PeriodStatus } | null; next: { id: string; name: string; status: PeriodStatus } | null;
  checks: CloseCheck[]; trialBalance: { debit: number; credit: number; closingDebit: number; closingCredit: number } | null; live: boolean;
  blocking: number; open: number; ready: boolean;
  actions: { startReview: boolean; backToOpen: boolean; close: boolean; lock: boolean; reopen: boolean; acknowledge: boolean };
  history: Array<{ label: string; at: string; actor: string | null; detail: string | null }>;
};
export type CloseStep = "review" | "back-to-open" | "close" | "lock" | "reopen" | "acknowledge" | "withdraw";

export const closeOverview = () => call<{ overview: CloseOverview }>("/period-close").then((r) => r.overview);
export const closeWorkspace = (periodId: string) => call<{ workspace: CloseWorkspace }>(`/period-close/${periodId}`).then((r) => r.workspace);
export const closeStep = (periodId: string, step: CloseStep, input: { note?: string; reason?: string; checkKey?: string } = {}) =>
  post<{ workspace: CloseWorkspace }>(`/period-close/${periodId}/${step}`, input).then((r) => r.workspace);
export const closeYear = (yearId: string, note?: string) => post<{ year: CloseYear }>(`/fiscal-years/${yearId}/close`, { note }).then((r) => r.year);

export const PERIOD_TONE: Record<PeriodStatus, "neutral" | "info" | "success" | "warning" | "danger"> = { open: "info", soft_closed: "warning", closed: "success", locked: "neutral" };
