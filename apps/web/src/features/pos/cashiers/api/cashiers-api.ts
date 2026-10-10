"use client";

// Browser client for Cashiers under /api/pos/cashiers. A cashier is the POS profile of a workspace user: where they may work and what they
// did. Signing in, employment and permissions stay with the user, HR and roles.
import { PosApiError } from "@/features/pos/shared/http";

export const CASHIERS_BASE = "/pos/cashiers";

export type CashierCapabilities = Record<"view" | "create" | "edit" | "status" | "assignOutlets" | "viewSessions" | "viewTransactions" | "viewCash", boolean>;
export type Ability = { key: string; label: string; allowed: boolean };
export type Cashier = {
  id: string; code: string; userId: string; name: string; fullName: string; displayName: string | null; email: string; userActive: boolean; employeeId: string | null;
  employeeNumber: string | null; status: "active" | "inactive"; isActive: boolean; operable: boolean; operationalState: "available" | "session_open" | "inactive";
  defaultOutletId: string | null; defaultOutlet: string | null; outletIds: string[]; outlets: string[]; currentSessionId: string | null; currentSession: string | null;
  currentOutletId: string | null; currentOutlet: string | null; currentTerminalId: string | null; currentTerminal: string | null; sessionOpenedAt: string | null;
  businessDate: string | null; notes: string | null; used: boolean; firstUsedAt: string | null; lastActivity: string | null; version: number;
  posRoles: string[]; canOperate: boolean; profileId?: string | null; profileName: string | null;
};
export type OutletAccess = { outletId: string; outlet: string | null; outletActive: boolean; isDefault: boolean; inSession: boolean; grantedAt: string; grantedBy: string | null };
export type SetupIssue = { code: string; field: string; message: string };
export type Blocker = { code: string; message: string };
export type CashierDetail = Cashier & { abilities: Ability[]; outletAccess: OutletAccess[]; setup: SetupIssue[]; capabilities: CashierCapabilities };
export type CashierList = { cashiers: Cashier[]; capabilities: CashierCapabilities };
export type CashierOptions = {
  members: Array<{ id: string; name: string; email: string; hasProfile: boolean }>; outlets: Array<{ id: string; label: string; active: boolean }>;
  employees: Array<{ id: string; label: string; userId: string | null }>; roles: string[]; nextCode: string; capabilities: CashierCapabilities;
};
export type SessionRow = {
  id: string; number: string; status: string; outlet: string; terminal: string; businessDate: string | null; openedAt: string | null; closedAt: string | null;
  openingCash?: number; expectedCash?: number; countedCash?: number | null; difference?: number | null;
};
export type TransactionRow = {
  id: string; kind: "sale" | "return"; number: string; at: string | null; outlet: string; terminal: string; session: string | null; customer: string | null; amount: number;
  payment: string | null; status: string; recordedAs: string | null;
};
export type HistoryRow = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; reason: string | null; actorName: string | null; createdAt: string };
export type OpenPosResult =
  | { action: "resume"; sessionId: string; outletId: string; terminalId: string; outlets: [] }
  | { action: "open_session"; sessionId: null; outlets: Array<{ outletId: string; outlet: string | null; isDefault: boolean; terminals: Array<{ terminalId: string; terminal: string | null }> }>;
      preselected: { outletId: string; terminalId: string } | null };
export type CashierFilters = Partial<Record<"view" | "search" | "outletId" | "role", string>>;

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  // The route layer spreads error details (issues, blockers, references) flat into the body.
  if (!response.ok || payload.ok === false) throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`/api/pos/cashiers${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  }).then(parse<T>);
}
const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listCashiers = (filters: CashierFilters = {}) => call<CashierList>(query(filters));
export const getCashierOptions = () => call<CashierOptions>("/options");
export const getCashier = (id: string) => call<{ cashier: CashierDetail }>(`/${id}`).then((result) => result.cashier);
export const createCashier = (input: Record<string, unknown>) => call<{ cashier: CashierDetail }>("", { method: "POST", json: input }).then((result) => result.cashier);
export const updateCashier = (id: string, input: Record<string, unknown>) => call<{ cashier: CashierDetail }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.cashier);
export const deleteCashier = (id: string) => call<{ deleted: true }>(`/${id}`, { method: "DELETE", json: {} });
export const getCashierStatusCheck = (id: string) => call<{ setup: SetupIssue[]; blockers: Blocker[] }>(`/${id}/status`);
export const setCashierStatus = (id: string, input: { status: "active" | "inactive"; reason?: string }) =>
  call<{ cashier: CashierDetail }>(`/${id}/status`, { method: "POST", json: input }).then((result) => result.cashier);
export const setCashierOutlets = (id: string, outletIds: string[], defaultOutletId?: string | null) =>
  call<{ cashier: CashierDetail }>(`/${id}/outlets`, { method: "PUT", json: { outletIds, ...(defaultOutletId !== undefined ? { defaultOutletId } : {}) } }).then((result) => result.cashier);
export const openPosForCashier = (id: string) => call<OpenPosResult>(`/${id}/open`, { method: "POST", json: {} });
const rows = <T>(id: string, view: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/${id}/views/${view}${query(filters)}`).then((result) => result.rows);
export const getCashierSessions = (id: string) => rows<SessionRow>(id, "sessions");
export const getCashierTransactions = (id: string, filters: Record<string, string | undefined> = {}) => rows<TransactionRow>(id, "transactions", filters);
export const getCashierHistory = (id: string) => rows<HistoryRow>(id, "history");

type Issue = { field: string; message: string };
const payloadOf = (error: unknown) => (error instanceof PosApiError ? (error.details as Record<string, unknown> | undefined) : undefined);
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof PosApiError ? error.code : undefined);
export const fieldErrors = (error: unknown): Record<string, string> =>
  Object.fromEntries(((payloadOf(error)?.issues as Issue[] | undefined) ?? []).map((issue) => [issue.field, issue.message]));
export const blockersOf = (error: unknown) => (payloadOf(error)?.blockers as Blocker[] | undefined) ?? [];
export const setupIssuesOf = (error: unknown) => (payloadOf(error)?.issues as SetupIssue[] | undefined) ?? [];

export const STATE_LABEL: Record<Cashier["operationalState"], string> = { available: "Available", session_open: "On a session", inactive: "Inactive" };
export const STATE_TONE: Record<Cashier["operationalState"], "success" | "info" | "neutral"> = { available: "success", session_open: "info", inactive: "neutral" };
