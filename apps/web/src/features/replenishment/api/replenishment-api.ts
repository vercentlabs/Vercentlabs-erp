"use client";

// Browser client for Replenishment under /api/inventory/replenishment: reorder rules (Min/Max per warehouse and item) and the planning status
// behind them. Planning only — drafts are opened in Procurement and Transfers, nothing here moves stock.
import { SalesApiError } from "@/features/sales/shared/http";

export type ReorderStatus = "reorder_required" | "out_of_stock" | "below_reorder_covered" | "ok" | "disabled";
export type Recommendation = {
  id: string; status: "open" | "actioned" | "dismissed" | "resolved"; actionType: "purchase_order" | "inventory_transfer" | null; actionId: string | null;
  actionNumber: string | null; actionHref: string | null; actionedAt: string | null; dismissedAt: string | null; dismissReason: string | null;
};
export type ReorderRule = {
  id: string; version: number; enabled: boolean; notes: string | null; itemId: string; sku: string; itemName: string; trackingType: string; baseUom: string | null;
  warehouseId: string; warehouse: string; warehouseName: string; reorderLevel: number; targetLevel: number; orderMultiple: number | null;
  eligibleOnHand: number; salesDemand: number; transferDemand: number; firmDemand: number; currentPosition: number; purchaseIncoming: number; transferIncoming: number;
  firmIncoming: number; projectedPosition: number; rawSuggested: number; suggested: number; status: ReorderStatus; statusLabel: string; outOfStock: boolean;
  nextIncoming: string | null; overdueIncoming: boolean; calculatedAt: string | null; recommendation: Recommendation | null;
};
export type Capabilities = {
  create: boolean; edit: boolean; disable: boolean; import: boolean; export: boolean; dismiss: boolean; viewDemand: boolean; viewIncoming: boolean; viewOtherStock: boolean;
  purchaseDraft: boolean; transferDraft: boolean; viewRequirements: boolean;
};
export type RuleList = { rows: ReorderRule[]; total: number; counts: { required: number; covered: number; outOfStock: number; rules: number }; capabilities: Capabilities };
export type DemandRow = { kind: "sales_order" | "transfer_out"; id: string; number: string; status: string; date: string | null; quantity: number; reserved?: number; destination?: string; href: string };
export type IncomingRow = { kind: "purchase_order" | "transfer_in" | "in_transit"; id: string; number: string; supplier?: string | null; source?: string; expected: string | null;
  overdue: boolean; quantity: number; href: string };
export type RuleDetail = {
  rule: ReorderRule; demand: DemandRow[] | null; incoming: IncomingRow[] | null;
  otherWarehouses: Array<{ warehouseId: string; warehouse: string; warehouseName: string; eligible: number; available: number }> | null;
  supplier: { supplierId: string; number: string | null; name: string | null; source: string; unitPrice: string | null; priceUomId: string | null; priceUom: string | null;
    currencyCode: string | null; leadTimeDays: number | null } | null;
  history: Array<{ type: string; summary: string; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null; at: string; by: string | null }>;
  capabilities: Capabilities;
};
export type ImportResult = {
  applied: boolean; summary: { rows: number; create: number; update: number; errors: number };
  rows: Array<{ line: number; sku: string; warehouse: string; enabled: boolean; reorderLevel: string; targetLevel: string; orderMultiple: string | null; action: "create" | "update" | "error"; errors: string[] }>;
};
export type Options = { warehouses: Array<{ id: string; code: string; name: string }>; categories: Array<{ id: string; name: string }>; capabilities: Capabilities };
export type Summary = { rules?: ReorderRule[]; counts: { below: number; required: number; covered: number; outOfStock: number; rules: number } } | null;

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/replenishment";
export const REPLENISHMENT_BASE = "/inventory/replenishment";
function call<T>(path: string, init?: { method?: string; json?: unknown; body?: FormData }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ?? (init?.json !== undefined ? JSON.stringify(init.json) : undefined),
  }).then(parse<T>);
}
export const queryOf = (params: Record<string, string | undefined>) => {
  const text = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  return text ? `?${text}` : "";
};

export const listRules = (filters: Record<string, string | undefined>) => call<RuleList>(queryOf(filters));
export const getOptions = () => call<{ options: Options }>("/options").then((result) => result.options);
export const getRule = (id: string) => call<{ detail: RuleDetail }>(`/${id}`).then((result) => result.detail);
export const createRule = (input: { itemId: string; warehouseId: string; reorderLevel: string; targetLevel: string; orderMultiple?: string | null; enabled?: boolean; notes?: string | null }) =>
  call<{ detail: RuleDetail }>("", { method: "POST", json: input }).then((result) => result.detail);
export const updateRule = (id: string, input: { reorderLevel?: string; targetLevel?: string; orderMultiple?: string | null; enabled?: boolean; notes?: string | null; expectedVersion?: number }) =>
  call<{ detail: RuleDetail }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.detail);
export const createPurchaseDraft = (id: string, input: { supplierId?: string; quantity?: string; unitPrice?: string; idempotencyKey: string }) =>
  call<{ draft: { purchaseOrderId: string; purchaseOrderNumber: string; href: string; quantity: number; baseQuantity: number } }>(`/${id}/purchase-draft`, { method: "POST", json: input })
    .then((result) => result.draft);
export const createTransferDraft = (id: string, input: { sourceWarehouseId: string; quantity?: string; idempotencyKey: string }) =>
  call<{ draft: { transferId: string; transferNumber: string | null; href: string; quantity: number } }>(`/${id}/transfer-draft`, { method: "POST", json: input }).then((result) => result.draft);
export const dismissRecommendation = (id: string, reason: string) => call<{ detail: RuleDetail }>(`/${id}/dismiss`, { method: "POST", json: { reason } }).then((result) => result.detail);
export const reconcile = () => call<{ reconciliation: { rules: number; differences: unknown[]; consistent: boolean } }>("/reconcile", { method: "POST", json: {} }).then((result) => result.reconciliation);
export const importRules = (file: File, apply: boolean) => {
  const body = new FormData();
  body.append("file", file);
  body.append("apply", apply ? "true" : "false");
  return call<{ import: ImportResult }>("/import", { method: "POST", body }).then((result) => result.import);
};
export const getSummary = (params: { itemId?: string; warehouseId?: string }) => call<{ summary: Summary }>(`/summary${queryOf(params)}`).then((result) => result.summary);
export const exportUrl = (filters: Record<string, string | undefined>, format: "csv" | "xlsx") => `${BASE}/export${queryOf({ ...filters, format })}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);

export const STATUS_TONE: Record<ReorderStatus, "danger" | "warning" | "info" | "success" | "neutral"> = {
  out_of_stock: "danger", reorder_required: "warning", below_reorder_covered: "info", ok: "success", disabled: "neutral",
};

// ---------------------------------------------------------------- Low-Stock Alerts (derived from the reorder status; never a second formula)
export type AlertCondition = "out_of_stock" | "replenishment_required" | "low_stock";
export type AlertSeverity = "critical" | "high" | "warning";
export type AlertFigures = { eligibleOnHand: number; firmDemand: number; currentPosition: number; firmIncoming: number; projectedPosition: number; reorderLevel: number;
  targetLevel: number; suggested: number };
export type LowStockAlert = {
  id: string; ruleId: string; occurrence: number; condition: AlertCondition; conditionLabel: string; severity: AlertSeverity; status: "open" | "acknowledged" | "resolved";
  negativeStock: boolean; overdueIncoming: boolean; itemId: string; sku: string; itemName: string; baseUom: string | null; warehouseId: string; warehouse: string; warehouseName: string;
  firstDetectedAt: string; conditionSince: string; lastEvaluatedAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null; resolvedAt: string | null;
  resolutionReason: string | null; resolutionLabel: string | null;
  live: (AlertFigures & { orderMultiple: number | null; rawSuggested: number; shortfallToReorder: number; nextIncoming: string | null }) | null; detected: AlertFigures;
};
export type AlertCapabilities = { acknowledge: boolean; viewHistory: boolean; export: boolean; purchaseDraft: boolean; transferDraft: boolean; editRule: boolean;
  viewDemand: boolean; viewIncoming: boolean; viewOtherStock: boolean };
export type AlertCounts = { outOfStock: number; replenishmentRequired: number; lowStock: number; unacknowledged: number; overdueIncoming: number; negativeStock: number };
export type AlertList = { rows: LowStockAlert[]; total: number; counts: AlertCounts | null; view: string; capabilities: AlertCapabilities };
export type AlertHistoryEntry = { kind: "event" | "action"; type: string; at: string; by: string | null; from?: string | null; to?: string | null; reason?: string | null;
  figures?: Record<string, unknown>; document?: { type: string; id: string; number: string | null; href: string } | null; quantity?: number | null; notes?: string | null };
export type AlertDetail = Omit<RuleDetail, "rule" | "history" | "capabilities"> & {
  alert: LowStockAlert; rule: ReorderRule | null; history: AlertHistoryEntry[] | null; capabilities: AlertCapabilities;
  occurrences: Array<{ id: string; occurrence: number; condition: AlertCondition; severity: AlertSeverity; status: string; from: string; to: string | null; resolution: string | null }>;
};

const ALERTS = "/alerts";
export const ALERT_VIEWS = [
  { id: "active", label: "All active" }, { id: "critical", label: "Critical" }, { id: "out_of_stock", label: "Out of stock" },
  { id: "replenishment_required", label: "Replenishment required" }, { id: "low_stock", label: "Low stock — covered" }, { id: "overdue", label: "Overdue incoming" },
  { id: "unacknowledged", label: "Unacknowledged" }, { id: "resolved", label: "Resolved" },
] as const;
export const listAlerts = (filters: Record<string, string | undefined>) => call<AlertList>(`${ALERTS}${queryOf(filters)}`);
export const getAlert = (id: string) => call<{ detail: AlertDetail }>(`${ALERTS}/${id}`).then((result) => result.detail);
export const acknowledgeAlert = (id: string, notes?: string) => call<{ detail: AlertDetail }>(`${ALERTS}/${id}/acknowledge`, { method: "POST", json: { notes } }).then((result) => result.detail);
export const acknowledgeAlerts = (alertIds: string[]) => call<{ result: { acknowledged: number; skipped: unknown[] } }>(`${ALERTS}/acknowledge`, { method: "POST", json: { alertIds } }).then((result) => result.result);
export const createAlertPurchaseDraft = (id: string, input: { supplierId?: string; quantity?: string; unitPrice?: string; idempotencyKey: string }) =>
  call<{ draft: { purchaseOrderId: string; href: string } }>(`${ALERTS}/${id}/purchase-draft`, { method: "POST", json: input }).then((result) => result.draft);
export const createAlertTransferDraft = (id: string, input: { sourceWarehouseId: string; quantity?: string; idempotencyKey: string }) =>
  call<{ draft: { transferId: string; href: string } }>(`${ALERTS}/${id}/transfer-draft`, { method: "POST", json: input }).then((result) => result.draft);
export const getAlertCounts = (warehouseId?: string) => call<{ counts: AlertCounts | null }>(`${ALERTS}/counts${queryOf({ warehouseId })}`).then((result) => result.counts);
export const alertExportUrl = (filters: Record<string, string | undefined>, format: "csv" | "xlsx") => `${BASE}${ALERTS}/export${queryOf({ ...filters, format })}`;
export const SEVERITY_TONE: Record<AlertSeverity, "danger" | "warning" | "info"> = { critical: "danger", high: "warning", warning: "info" };
export const ALERTS_BASE = `${REPLENISHMENT_BASE}/alerts`;
