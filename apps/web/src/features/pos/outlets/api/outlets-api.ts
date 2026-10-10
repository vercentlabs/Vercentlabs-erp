"use client";

// Browser client for Stores & Outlets under /api/pos/outlets. An outlet points at the company's own warehouse, GST registration, price list,
// customer and accounts; it never holds a stock quantity, a price or a balance of its own.
import { PosApiError } from "@/features/pos/shared/http";

export const OUTLETS_BASE = "/pos/outlets";

export type OutletCapabilities = Record<
  "view" | "create" | "edit" | "status" | "manageInventory" | "manageTax" | "managePayments" | "manageAccess" | "viewTransactions" | "viewSessions" | "viewFinance",
  boolean
>;
export type OutletAddress = { line1: string | null; line2: string | null; city: string | null; state: string | null; stateCode: string | null; postalCode: string | null; countryCode: string | null };
export type BusinessHours = Partial<Record<string, { opens?: string; closes?: string; closed?: boolean }>>;
export type Outlet = {
  id: string; code: string; name: string; type: string; typeLabel: string; status: "active" | "inactive"; isActive: boolean; address: OutletAddress; addressText: string;
  timezone: string | null; currencyCode: string | null; managerUserId: string | null; managerName: string | null; phone: string | null; email: string | null;
  warehouseId: string; warehouse: string | null; warehouseActive: boolean; sellingLocationId: string | null; sellingLocation: string | null;
  returnsLocationId: string | null; returnsLocation: string | null; taxRegistrationId: string | null; taxRegistration: string | null; gstin: string | null;
  registrationStateCode: string | null; legalName: string | null; priceListId: string | null; priceList: string | null;
  walkIn: { allowWalkInSales: boolean; allowOptionalBuyerName: boolean; allowReceiptContactCapture: boolean }; cashAccountId: string | null; cashAccount: string | null; receiptMessage: string | null; businessHours: BusinessHours; notes: string | null;
  terminals: number; activeTerminals: number; openSessions: number; version: number; createdAt: string; updatedAt: string;
};
export type PaymentMethod = { method: string; label: string; enabled: boolean; providerKey: string | null; accountId: string | null; account: string | null };
export type SetupIssue = { code: string; field: string; message: string };
export type Blocker = { code: string; count: number; message: string };
export type OutletDocuments = {
  gstin: string | null; legalName: string | null; taxRegistration: string | null; receiptSeries: Array<{ terminal: string; prefix: string }>;
  receiptHeader: { displayName: string; address: string; phone: string | null; email: string | null }; receiptMessage: string | null;
};
export type OutletDetail = Outlet & {
  today: { sales: number; total: number } | null; paymentMethods: PaymentMethod[]; documents: OutletDocuments; setup: SetupIssue[]; capabilities: OutletCapabilities;
};
export type OutletList = { outlets: Outlet[]; capabilities: OutletCapabilities };
type Choice = { id: string; label: string };
export type OutletOptions = {
  types: Array<{ code: string; label: string }>; paymentMethods: Array<{ code: string; label: string }>; weekdays: string[]; providers: string[];
  members: Array<{ id: string; name: string }>; warehouses: Choice[]; locations: Array<Choice & { warehouseId: string; purpose: string }>;
  registrations: Array<Choice & { stateCode: string | null; gstin: string | null }>; priceLists: Choice[]; customers: Choice[]; accounts: Array<Choice & { type: string }>;
  states: string[]; cities: string[]; defaults: { timezone: string; countryCode: string; currencyCode: string }; capabilities: OutletCapabilities;
};
// A cashier who may work at the outlet (Cashiers), with what their POS role lets them do.
export type AccessEntry = {
  id: string; code: string; userId: string; name: string; fullName: string; email: string; isActive: boolean; operable: boolean; operationalState: "available" | "session_open" | "inactive";
  currentTerminal: string | null; posRoles: string[]; canOperate: boolean; abilities: Array<{ key: string; label: string; allowed: boolean }>;
};
export type InventorySummary = {
  warehouseId: string; warehouse: string | null; warehouseActive: boolean; sellingLocationId: string | null; sellingLocation: string | null;
  returnsLocationId: string | null; returnsLocation: string | null;
  stock: { onHand: number; reserved: number; restricted: number; available: number; items: number; value?: number }; showsValue: boolean; sharedWith: string[];
};
export type TerminalRow = { id: string; code: string; name: string; status: string; receiptPrefix: string; currentSession: string | null; currentSessionId: string | null; cashier: string | null; lastActivity: string | null };
export type SessionRow = {
  id: string; number: string; status: string; terminal: string; cashier: string | null; businessDate: string | null; openedAt: string | null; closedAt: string | null;
  openingCash?: number; closingCash?: number | null; difference?: number | null;
};
export type TransactionRow = { id: string; kind: "sale" | "return"; number: string; at: string | null; terminal: string; cashier: string | null; customer: string | null; amount: number; payment: string | null; status: string };
export type HistoryRow = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; reason: string | null; actorName: string | null; createdAt: string };
export type OutletFilters = Partial<Record<"view" | "search" | "state" | "city" | "warehouseId" | "managerUserId", string>>;

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  // The route layer spreads error details (issues, blockers, references) flat into the body.
  if (!response.ok || payload.ok === false) throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`/api/pos/outlets${path}`, {
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

export const listOutlets = (filters: OutletFilters = {}) => call<OutletList>(query(filters));
export const getOutletOptions = () => call<OutletOptions>("/options");
export const getOutlet = (id: string) => call<{ outlet: OutletDetail }>(`/${id}`).then((result) => result.outlet);
export const createOutlet = (input: Record<string, unknown>) => call<{ outlet: OutletDetail }>("", { method: "POST", json: input }).then((result) => result.outlet);
export const updateOutlet = (id: string, input: Record<string, unknown>) => call<{ outlet: OutletDetail }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.outlet);
export const deleteOutlet = (id: string) => call<{ deleted: true }>(`/${id}`, { method: "DELETE", json: {} });
export const getOutletStatusCheck = (id: string) => call<{ setup: SetupIssue[]; blockers: Blocker[] }>(`/${id}/status`);
export const setOutletStatus = (id: string, input: { status: "active" | "inactive"; reason?: string }) =>
  call<{ outlet: OutletDetail }>(`/${id}/status`, { method: "POST", json: input }).then((result) => result.outlet);
export const getOutletAccess = (id: string) => call<{ access: AccessEntry[] }>(`/${id}/access`).then((result) => result.access);
export const setOutletPaymentMethods = (id: string, methods: Array<{ method: string; enabled: boolean; accountId?: string | null; providerKey?: string | null }>) =>
  call<{ methods: PaymentMethod[] }>(`/${id}/payment-methods`, { method: "PUT", json: { methods } }).then((result) => result.methods);
export const getOutletInventory = (id: string) => call<{ inventory: InventorySummary }>(`/${id}/views/inventory`).then((result) => result.inventory);
const rows = <T>(id: string, view: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/${id}/views/${view}${query(filters)}`).then((result) => result.rows);
export const getOutletTerminals = (id: string) => rows<TerminalRow>(id, "terminals");
export const getOutletSessions = (id: string, filters: Record<string, string | undefined> = {}) => rows<SessionRow>(id, "sessions", filters);
export const getOutletTransactions = (id: string, filters: Record<string, string | undefined> = {}) => rows<TransactionRow>(id, "transactions", filters);
export const getOutletHistory = (id: string) => rows<HistoryRow>(id, "history");

type Issue = { field: string; message: string };
const payloadOf = (error: unknown) => (error instanceof PosApiError ? (error.details as Record<string, unknown> | undefined) : undefined);
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof PosApiError ? error.code : undefined);
export const fieldErrors = (error: unknown): Record<string, string> =>
  Object.fromEntries(((payloadOf(error)?.issues as Issue[] | undefined) ?? []).map((issue) => [issue.field, issue.message]));
export const blockersOf = (error: unknown) => (payloadOf(error)?.blockers as Blocker[] | undefined) ?? [];
export const setupIssuesOf = (error: unknown) => (payloadOf(error)?.issues as SetupIssue[] | undefined) ?? [];
