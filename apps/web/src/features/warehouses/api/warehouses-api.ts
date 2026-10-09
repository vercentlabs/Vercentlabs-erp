"use client";

// Browser client for Warehouses under /api/inventory/warehouses. A warehouse never holds an editable quantity: every stock figure here is
// read from Inventory.
import { SalesApiError } from "@/features/sales/shared/http";

export type WarehouseCapabilities = Record<"view" | "create" | "edit" | "changeCode" | "status" | "manageLocations" | "manageAccess" | "viewStock" | "viewValue", boolean>;
export type WarehouseOperation = "receive" | "ship" | "transfer" | "adjust" | "opening" | "purchase_return" | "sales_return";

export type WarehouseStock = { onHand: number; reserved: number; restricted: number; available: number; items: number; value?: number; incoming?: number; outgoing?: number };
export type WarehouseAddress = { line1: string | null; line2: string | null; city: string | null; state: string | null; stateCode: string | null; postalCode: string | null; countryCode: string | null };
export type Warehouse = {
  id: string; code: string; name: string; description: string | null; type: "stores" | "transit"; typeLabel: string; address: WarehouseAddress; addressText: string;
  timezone: string | null; managerUserId: string | null; managerName: string | null; contactName: string | null; phone: string | null; email: string | null;
  taxRegistrationId: string | null; taxRegistration: string | null; receivingEnabled: boolean; shippingEnabled: boolean; transferEnabled: boolean; returnsEnabled: boolean;
  isDefault: boolean; system: boolean; status: "active" | "inactive"; isActive: boolean; mainLocationId: string | null; version: number; createdAt: string; updatedAt: string;
  stock: WarehouseStock | null;
};
export type WarehouseLocation = {
  id: string; warehouseId: string; code: string; name: string; purpose: string; purposeLabel: string; structure: string; parentLocationId: string | null; parentCode: string | null;
  allowStock: boolean; status: "active" | "inactive"; isActive: boolean; isMain: boolean; isDefaultStorage: boolean; isDefaultReceiving: boolean; isDefaultReturns: boolean;
  isDefaultShipping: boolean; onHand: number | null; version: number; disposition: "available" | "quality_hold" | "quarantined" | "damaged"; dispositionLabel: string;
  allowAllocation: boolean; allocatable: boolean;
};
export type WarehouseAccessEntry = { userId: string; name: string; email: string; operations: WarehouseOperation[] };
export type WarehouseDetail = Warehouse & { locations: WarehouseLocation[]; access: WarehouseAccessEntry[]; capabilities: WarehouseCapabilities; showsStock: boolean };
export type WarehouseList = { warehouses: Warehouse[]; showsStock: boolean; showsValue: boolean; capabilities: WarehouseCapabilities };
export type DefaultWarehouse = { warehouseId: string; code: string; name: string; source: "user" | "company" } | null;
export type WarehouseOptions = {
  types: Array<{ code: string; label: string }>; purposes: Array<{ code: string; label: string }>; structures: string[]; dispositions: Array<{ code: string; label: string }>;
  operations: Array<{ code: WarehouseOperation; label: string }>; members: Array<{ id: string; name: string }>; registrations: Array<{ id: string; label: string; stateCode: string | null }>;
  defaults: { timezone: string; countryCode: string }; myDefault: DefaultWarehouse; capabilities: WarehouseCapabilities;
};
export type Blocker = { code: string; message: string };
export type ItemBalance = { itemId: string; sku: string; name: string; category: string | null; uom: string | null; onHand: number; reserved: number; qualityHold: number; available: number; value?: number };
export type MovementRow = {
  id: string; number: string; type: string; referenceType: string | null; reference: string | null; occurredAt: string; sku: string; item: string; in: number | null; out: number | null;
  location: string; batch: string | null; serial: string | null;
};
export type FlowRow = { kind: string; id: string; reference: string; sku: string; item: string; quantity: number; expected?: string | null; other: string | null };
export type TransferRow = { id: string; number: string; status: string; direction: "inbound" | "outbound"; quantity: number; sku: string; item: string; source: string; destination: string; createdAt: string; completedAt: string | null };
export type BatchRow = { batchId: string; batch: string; expiry: string | null; status: string; sku: string; item: string; location: string; quantity: number; disposition: string };
export type SerialRow = { serialId: string; serial: string; status: string; sku: string; item: string; location: string };
export type HistoryRow = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; reason: string | null; actorName: string | null; createdAt: string };
export type WarehouseFilters = Partial<Record<"view" | "search" | "state" | "city" | "managerUserId" | "receiving" | "shipping", string>>;

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}

function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`/api/inventory/warehouses${path}`, {
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

export const listWarehouses = (filters: WarehouseFilters = {}) => call<WarehouseList>(query(filters));
export const getWarehouseOptions = () => call<WarehouseOptions>("/options");
export const getWarehouse = (id: string) => call<{ warehouse: WarehouseDetail }>(`/${id}`).then((result) => result.warehouse);
export const createWarehouse = (input: Record<string, unknown>) => call<{ warehouse: WarehouseDetail }>("", { method: "POST", json: input }).then((result) => result.warehouse);
export const updateWarehouse = (id: string, input: Record<string, unknown>) =>
  call<{ warehouse: WarehouseDetail }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.warehouse);
export const deleteWarehouse = (id: string) => call<{ deleted: true }>(`/${id}`, { method: "DELETE", json: {} });
export const getDeactivationBlockers = (id: string) => call<{ blockers: Blocker[] }>(`/${id}/status`).then((result) => result.blockers);
export const setWarehouseStatus = (id: string, input: { status: "active" | "inactive"; reason?: string; replacementDefaultId?: string }) =>
  call<{ warehouse: WarehouseDetail }>(`/${id}/status`, { method: "POST", json: input }).then((result) => result.warehouse);
export const createLocation = (warehouseId: string, input: Record<string, unknown>) =>
  call<{ location: WarehouseLocation }>(`/${warehouseId}/locations`, { method: "POST", json: input }).then((result) => result.location);
export const updateLocation = (warehouseId: string, locationId: string, input: Record<string, unknown>) =>
  call<{ location: WarehouseLocation }>(`/${warehouseId}/locations/${locationId}`, { method: "PATCH", json: input }).then((result) => result.location);
export const setLocationStatus = (warehouseId: string, locationId: string, status: "active" | "inactive") =>
  call<{ location: WarehouseLocation }>(`/${warehouseId}/locations/${locationId}/status`, { method: "POST", json: { status } }).then((result) => result.location);
export const setDefaultLocation = (warehouseId: string, kind: "receiving" | "returns" | "shipping", locationId: string | null) =>
  call<{ locations: WarehouseLocation[] }>(`/${warehouseId}/default-locations`, { method: "PUT", json: { kind, locationId } });
export const setWarehouseAccess = (warehouseId: string, entries: Array<{ userId: string; operations: WarehouseOperation[] }>) =>
  call<{ access: WarehouseAccessEntry[] }>(`/${warehouseId}/access`, { method: "PUT", json: { entries } }).then((result) => result.access);
export const getMyDefaultWarehouse = (operation?: WarehouseOperation) => call<{ default: DefaultWarehouse }>(`/my-default${query({ operation })}`).then((result) => result.default);
export const setMyDefaultWarehouse = (warehouseId: string | null) => call<{ default: DefaultWarehouse }>("/my-default", { method: "PUT", json: { warehouseId } }).then((result) => result.default);

export const getWarehouseStock = (id: string, filters: Record<string, string | undefined> = {}) =>
  call<{ items: ItemBalance[]; showsValue: boolean }>(`/${id}/views/stock${query(filters)}`);
const rows = <T>(id: string, view: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/${id}/views/${view}${query(filters)}`).then((result) => result.rows);
export const getWarehouseMovements = (id: string, filters: Record<string, string | undefined> = {}) => rows<MovementRow>(id, "movements", filters);
export const getWarehouseIncoming = (id: string) => rows<FlowRow>(id, "incoming");
export const getWarehouseOutgoing = (id: string) => rows<FlowRow>(id, "outgoing");
export const getWarehouseTransfers = (id: string) => rows<TransferRow>(id, "transfers");
export const getWarehouseBatches = (id: string) => rows<BatchRow>(id, "batches");
export const getWarehouseSerials = (id: string) => rows<SerialRow>(id, "serials");
export const getWarehouseHistory = (id: string) => rows<HistoryRow>(id, "history");

type Issue = { field: string; message: string };
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = error instanceof SalesApiError ? (error.payload?.issues as Issue[] | undefined) : undefined;
  return Object.fromEntries((issues ?? []).map((issue) => [issue.field, issue.message]));
}
export const blockersOf = (error: unknown) => (error instanceof SalesApiError ? (error.payload?.blockers as Blocker[] | undefined) ?? [] : []);
