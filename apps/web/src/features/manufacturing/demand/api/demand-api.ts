"use client";

// Manufacturing from Sales demand: the client of /api/manufacturing/{sales-demand, orders/from-sales-demand, demand-allocations, item-policies,
// demand-reports} and /api/sales/orders/{id}/manufacturing-status.
import { MfgApiError } from "@/features/manufacturing/shared/client";
import type { MoOrder, MoPreview } from "@/features/manufacturing/orders/api/mo-api";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new MfgApiError(payload.message || "The request could not be completed.", response.status, payload.code) as MfgApiError & { details?: Record<string, unknown> };
    error.details = payload.details;
    throw error;
  }
  return payload as T;
}
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
const send = <T>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });

export type DemandStatus = "NEEDS_REVIEW" | "PARTIALLY_COVERED" | "COVERED" | "IN_PRODUCTION" | "READY_FOR_FULFILLMENT" | "FULFILLED" | "ON_HOLD" | "CANCELLED";
export type DemandAllocation = { id: string; orderId: string; orderNumber: string; orderStatus: string; status: string; allocated: string; received: string; reserved: string; fulfilled: string;
  open: string; plannedEndAt: string; releaseReason: string | null; exception: string | null };
export type Demand = {
  id: string; version: number; status: DemandStatus; statusLabel: string; exception: string | null;
  salesOrder: { id: string; number: string; status: string; versionNumber: number; customer: string | null; priority: string | null };
  line: { id: string; sequence: number; quantity: string | null; uom: string | null }; item: { id: string; code: string; name: string; baseUom: string | null };
  warehouseId: string | null; requiredDate: string | null;
  policy: { supplyPolicy: "MAKE_TO_ORDER" | "MAKE_TO_STOCK"; leadTimeDays: number | null; minimumBatch: string | null; increment: string | null; materialWarehouseId: string | null; manufacturingWarehouseId: string | null };
  quantities: Record<"ordered" | "cancelled" | "delivered" | "outstanding" | "reservedStock" | "inProduction" | "proposed" | "readyToAllocate" | "uncovered" | "freeStock" | "recommended" | "plannable" | "overcommitted", string>;
  bom: { status: "EFFECTIVE" | "NOT_EFFECTIVE" | "MISSING"; revisionId: string | null }; warnings: string[]; allocations: DemandAllocation[];
  can: Record<"plan" | "createOrder" | "allocate" | "reallocate" | "release" | "reserve" | "setPolicy", boolean>;
};
export type DemandDetail = Demand & { history: Array<{ action: string; summary: string | null; quantity: string | null; order: string | null; actor: string | null; at: string }>;
  candidateOrders: Array<{ id: string; number: string; status: string; unassigned: string; plannedEndAt: string }> };
export type DemandPreview = { demands: Demand[]; recommended: string; quantity: string; plannedStartAt: string; plannedEndAt: string; requiredDate: string | null; warnings: string[];
  materials: MoPreview | null; materialError: string | null };
export type SalesProgress = { salesOrderId: string; canPlan: boolean; lines: Array<{ demandId: string; status: DemandStatus; statusLabel: string; item: { code: string; name: string; baseUom: string | null };
  requiredDate: string | null; ordered: string; delivered: string; reservedStock: string; inProduction: string; planned: string; uncovered: string; readyToAllocate: string; warnings: string[];
  orders: Array<{ id: string; number: string; status: string; assigned: string; received: string; plannedEndAt: string }> }> };

export const listDemand = (filters: Record<string, string | undefined>) => call<{ demands: Demand[]; totals: { lines: number; uncovered: string; recommended: string } }>(`/manufacturing/sales-demand${qs(filters)}`);
export const getDemand = (id: string) => call<{ demand: DemandDetail }>(`/manufacturing/sales-demand/${id}`).then((r) => r.demand);
export const previewDemand = (input: Record<string, unknown>) => send<{ preview: DemandPreview }>(`/manufacturing/sales-demand/preview`, input).then((r) => r.preview);
export const createFromDemand = (input: Record<string, unknown>) => send<{ order: MoOrder; allocations: Array<{ salesOrder: string; proposed: string }> }>(`/manufacturing/orders/from-sales-demand`, input);
export const allocateSupply = (input: Record<string, unknown>) => send<{ demand: DemandDetail }>(`/manufacturing/demand-allocations`, input).then((r) => r.demand);
export const releaseAllocation = (id: string, reason: string, quantity?: string) => send<{ demand: DemandDetail }>(`/manufacturing/demand-allocations/${id}/release`, { reason, quantity }).then((r) => r.demand);
export const reassignAllocation = (id: string, input: Record<string, unknown>) => send<{ from: DemandDetail; to: DemandDetail }>(`/manufacturing/demand-allocations/${id}/reassign`, input);
export const reserveForSales = (id: string, input: Record<string, unknown> = {}) => send<{ demand: DemandDetail }>(`/manufacturing/sales-demand/${id}/reserve`, input).then((r) => r.demand);
export const setItemPolicy = (itemId: string, input: Record<string, unknown>) => send(`/manufacturing/item-policies/${itemId}`, input, "PUT");
export const demandReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/manufacturing/demand-reports${qs({ kind })}`).then((r) => r.rows);
export const salesManufacturingStatus = (orderId: string) => call<{ progress: SalesProgress }>(`/sales/orders/${orderId}/manufacturing-status`).then((r) => r.progress);

export const DEMAND_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  NEEDS_REVIEW: "warning", PARTIALLY_COVERED: "warning", COVERED: "info", IN_PRODUCTION: "info", READY_FOR_FULFILLMENT: "success", FULFILLED: "neutral", ON_HOLD: "warning", CANCELLED: "neutral",
};
export const DEMAND_BASE = "/manufacturing/sales-demand";
