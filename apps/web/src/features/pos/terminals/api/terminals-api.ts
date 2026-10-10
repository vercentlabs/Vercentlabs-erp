"use client";

// Browser client for POS Terminals under /api/pos/terminals. A terminal is a register inside an outlet: it inherits the outlet's warehouse,
// prices and tax, and overrides only its selling location, cash, payment methods, device and receipt series.
import { PosApiError } from "@/features/pos/shared/http";

export const TERMINALS_BASE = "/pos/terminals";

export type TerminalCapabilities = Record<
  "view" | "create" | "edit" | "status" | "configureInventory" | "configureCash" | "configurePayments" | "configureNumbering" | "configureHardware" | "viewSessions" | "viewTransactions",
  boolean
>;
type Resolved = { id: string | null; label: string | null; source?: string };
export type EffectiveConfiguration = {
  outletId: string; outlet: string | null; outletActive: boolean; terminalActive: boolean; operable: boolean; warehouseId: string; warehouse: string | null;
  sellingLocation: Resolved & { source: "terminal" | "outlet" | "warehouse" }; returnsLocation: Resolved; priceList: Resolved;
  taxRegistration: Resolved & { gstin: string | null }; walkInCustomer: Resolved; cashManagementEnabled: boolean;
  cashAccount: Resolved & { source: "terminal" | "outlet" | "company" | "none" }; paymentMethods: Array<{ method: string; label: string; providerKey: string | null }>;
  paymentDeviceRef: string | null; receiptPrefix: string; timezone: string | null; currencyCode: string | null;
};
export type Terminal = {
  id: string; code: string; name: string; status: "active" | "inactive"; isActive: boolean; outletId: string; outletCode: string; outlet: string | null; outletActive: boolean;
  operable: boolean; operationalState: "available" | "session_open" | "unavailable"; currentSessionId: string | null; currentSession: string | null;
  currentCashierId: string | null; currentCashier: string | null; sessionOpenedAt: string | null; businessDate: string | null; cashManagementEnabled: boolean;
  sellingLocationId: string | null; sellingLocation: string | null; cashAccountId: string | null; cashAccount: string | null; paymentMethods: string[] | null;
  paymentDeviceRef: string | null; receiptPrefix: string; deviceLabel: string | null; receiptPrinter: string | null; cashDrawer: boolean; barcodeScanning: boolean;
  notes: string | null; used: boolean; firstUsedAt: string | null; lastActivity: string | null; lastSaleAt: string | null; version: number; createdAt: string; updatedAt: string;
};
export type SetupIssue = { code: string; field: string; message: string };
export type Blocker = { code: string; count: number; message: string };
export type TerminalDetail = Terminal & { effective: EffectiveConfiguration; setup: SetupIssue[]; capabilities: TerminalCapabilities };
export type TerminalList = { terminals: Terminal[]; capabilities: TerminalCapabilities };
export type TerminalOptions = {
  outlets: Array<{ id: string; label: string; code: string; active: boolean; warehouseId: string; methods: string[] }>;
  locations: Array<{ id: string; warehouseId: string; label: string }>; cashAccounts: Array<{ id: string; label: string }>;
  paymentMethods: Array<{ code: string; label: string }>; capabilities: TerminalCapabilities;
};
export type SessionRow = { id: string; number: string; status: string; cashier: string | null; businessDate: string | null; openedAt: string | null; closedAt: string | null; openingCash?: number; difference?: number | null };
export type TransactionRow = { id: string; kind: "sale" | "return"; number: string; at: string | null; cashier: string | null; customer: string | null; items: number | null; amount: number; payment: string | null; status: string };
export type HistoryRow = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; reason: string | null; actorName: string | null; createdAt: string };
export type OpenPosResult = { action: "resume" | "open_session"; terminal: Terminal; sessionId: string | null };
export type TerminalFilters = Partial<Record<"view" | "search" | "outletId" | "cash", string>>;

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  // The route layer spreads error details (issues, blockers, references) flat into the body.
  if (!response.ok || payload.ok === false) throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`/api/pos/terminals${path}`, {
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

export const listTerminals = (filters: TerminalFilters = {}) => call<TerminalList>(query(filters));
export const getTerminalOptions = () => call<TerminalOptions>("/options");
export const getTerminal = (id: string) => call<{ terminal: TerminalDetail }>(`/${id}`).then((result) => result.terminal);
export const createTerminal = (input: Record<string, unknown>) => call<{ terminal: TerminalDetail }>("", { method: "POST", json: input }).then((result) => result.terminal);
export const updateTerminal = (id: string, input: Record<string, unknown>) => call<{ terminal: TerminalDetail }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.terminal);
export const deleteTerminal = (id: string) => call<{ deleted: true }>(`/${id}`, { method: "DELETE", json: {} });
export const getTerminalStatusCheck = (id: string) => call<{ setup: SetupIssue[]; blockers: Blocker[] }>(`/${id}/status`);
export const setTerminalStatus = (id: string, input: { status: "active" | "inactive"; reason?: string }) =>
  call<{ terminal: TerminalDetail }>(`/${id}/status`, { method: "POST", json: input }).then((result) => result.terminal);
export const openPos = (id: string) => call<OpenPosResult>(`/${id}/open`, { method: "POST", json: {} });
const rows = <T>(id: string, view: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/${id}/views/${view}${query(filters)}`).then((result) => result.rows);
export const getTerminalSessions = (id: string) => rows<SessionRow>(id, "sessions");
export const getTerminalTransactions = (id: string, filters: Record<string, string | undefined> = {}) => rows<TransactionRow>(id, "transactions", filters);
export const getTerminalHistory = (id: string) => rows<HistoryRow>(id, "history");

type Issue = { field: string; message: string };
const payloadOf = (error: unknown) => (error instanceof PosApiError ? (error.details as Record<string, unknown> | undefined) : undefined);
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof PosApiError ? error.code : undefined);
export const fieldErrors = (error: unknown): Record<string, string> =>
  Object.fromEntries(((payloadOf(error)?.issues as Issue[] | undefined) ?? []).map((issue) => [issue.field, issue.message]));
export const blockersOf = (error: unknown) => (payloadOf(error)?.blockers as Blocker[] | undefined) ?? [];
export const setupIssuesOf = (error: unknown) => (payloadOf(error)?.issues as SetupIssue[] | undefined) ?? [];

export const STATE_LABEL: Record<Terminal["operationalState"], string> = { available: "Available", session_open: "Session open", unavailable: "Unavailable" };
export const STATE_TONE: Record<Terminal["operationalState"], "success" | "info" | "neutral"> = { available: "success", session_open: "info", unavailable: "neutral" };
