"use client";

// Browser client for Goods Issues under /api/inventory/goods-issues: stock deliberately taken out of inventory for a known internal purpose
// (consumption, maintenance, samples, project use, scrap and disposal). Drafted, posted once, reversed fully or partly; never edited after posting.
import { SalesApiError } from "@/features/sales/shared/http";

export type GoodsIssueStatus = "draft" | "posted" | "partially_reversed" | "reversed" | "cancelled";
export type Disposition = "available" | "quality_hold" | "quarantined" | "damaged" | "expired";
export type Reason = {
  id: string; code: string; name: string; description: string | null; allowedDispositions: Disposition[]; requiresRecipient: boolean; requiresNotes: boolean;
  expenseAccountId: string | null; expenseAccount: string | null; isSystem: boolean; isDisposal: boolean; status: "active" | "inactive"; version: number;
};
export type GoodsIssueHeader = {
  id: string; number: string; status: GoodsIssueStatus; warehouseId: string; warehouse: string; warehouseName: string; issueDate: string; reasonId: string; reasonCode: string; reason: string;
  issueToType: string | null; issueToId: string | null; issuedTo: string | null; issueToText: string | null; projectId: string | null; project: string | null; costCenterId: string | null;
  costCenter: string | null; externalReference: string | null; notes: string | null; issuedBy: string | null; issuedByName: string | null; postedAt: string | null; postedByName: string | null;
  createdAt: string; createdByName: string | null; cancelledAt: string | null; cancelReason: string | null; lineCount: number; version: number; value?: number;
};
export type GoodsIssueLine = {
  id: string; lineNumber: number; itemId: string; sku: string; itemName: string; trackingType: "none" | "batch" | "serial"; quantity: number; uomId: string; uom: string; conversion: number;
  baseQuantity: number; baseUom: string | null; locationId: string | null; location: string; sourceDisposition: Disposition; reasonId: string | null; notes: string | null; reversedQuantity: number;
  batches: Array<{ batchId: string; batch: string; expiresOn: string | null; quantity: number; reversed: number }>; serials: Array<{ id: string; serialNumber: string; reversed: boolean }>;
  availableNow?: number; dispositionNow?: string; value?: number;
};
export type LedgerMovement = {
  id: string; number: string; type: string; typeLabel: string; effectiveAt: string; postedAt: string; sku: string; itemName: string; warehouse: string; location: string; batch: string | null;
  serial: string | null; quantity: number; baseUom: string | null; source: { lineId: string | null }; unitCost?: number; value?: number;
};
export type GoodsIssueDetail = {
  goodsIssue: GoodsIssueHeader; lines: GoodsIssueLine[]; movements: LedgerMovement[]; history: Array<{ type: string; summary: string; at: string; actor: string | null }>;
  reversals: Array<{ id: string; reason: string; date: string; quantity: number; createdByName: string | null; at: string; value?: number; journalEntryId?: string | null }>;
  journals: Array<{ id: string; number: string; date: string; status: string; reversal: boolean; href: string }> | null;
  files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
  capabilities: { edit: boolean; post: boolean; cancel: boolean; reverse: boolean; seesCost: boolean; seesAccounting: boolean };
};
export type GoodsIssueOptions = {
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean; locations: Array<{ id: string; code: string; name: string; isMain: boolean }> }>;
  reasons: Reason[]; dispositions: Array<{ id: Disposition; label: string }>; issueToTypes: Array<{ id: string; label: string }>;
  departments: Array<{ id: string; name: string }>; employees: Array<{ id: string; name: string }>; projects: Array<{ id: string; name: string }>; costCenters: Array<{ id: string; name: string }>;
  capabilities: { create: boolean; post: boolean; reverse: boolean; issueRestricted: boolean; dispose: boolean; seesCost: boolean; manageReasons: boolean };
};
export type Availability = {
  positions: Array<{ locationId: string | null; location: string; batchId: string | null; batch: string | null; expiresOn: string | null; disposition: string; onHand: number; reserved: number; available: number }>;
  serials: Array<{ id: string; serialNumber: string; locationId: string | null; batchId: string | null; reserved: boolean }>;
  totals: { onHand: number; reserved: number; available: number };
};
export type LineInput = {
  itemId: string; quantity: string; uomId?: string; locationId?: string | null; sourceDisposition?: Disposition; batches?: Array<{ batchId: string; quantity: string }>; serialIds?: string[];
  reasonId?: string | null; notes?: string | null;
};
export type GoodsIssueInput = {
  warehouseId: string; issueDate?: string; reasonId: string; issueToType?: string | null; issueToId?: string | null; issueToText?: string | null; projectId?: string | null;
  costCenterId?: string | null; externalReference?: string | null; notes?: string | null; lines: LineInput[]; expectedVersion?: number; post?: boolean; idempotencyKey?: string;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/goods-issues";
function call<T>(path: string, init?: { method?: string; json?: unknown; body?: FormData }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ?? (init?.json !== undefined ? JSON.stringify(init.json) : undefined),
  }).then(parse<T>);
}
const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listGoodsIssues = (filters: Record<string, string | undefined>) => call<{ total: number; rows: GoodsIssueHeader[]; canCreate: boolean; seesCost: boolean }>(query(filters));
export const getGoodsIssueOptions = () => call<{ options: GoodsIssueOptions }>("/options").then((result) => result.options);
export const getAvailability = (warehouseId: string, itemId: string) => call<{ availability: Availability }>(`/availability${query({ warehouseId, itemId })}`).then((result) => result.availability);
export const getGoodsIssue = (id: string) => call<{ detail: GoodsIssueDetail }>(`/${id}`).then((result) => result.detail);
export const createGoodsIssue = (input: GoodsIssueInput) => call<{ detail: GoodsIssueDetail }>("", { method: "POST", json: input }).then((result) => result.detail);
export const updateGoodsIssue = (id: string, input: Partial<GoodsIssueInput>) => call<{ detail: GoodsIssueDetail }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.detail);
// negative: untracked lines short of stock that the company lets go below zero with an authorised override (Negative-Stock Control).
export type NegativeShortage = { lineId: string; lineNumber: number; sku: string; location: string; uom: string; onHand: string; requested: string; projected: string };
export type GoodsIssueValidation = { ready: boolean; errors: Array<{ message: string; code: string }>; negative: NegativeShortage[]; canOverrideNegative: boolean;
  overrideReasons: Array<{ id: string; label: string }> };
export const validateGoodsIssue = (id: string) => call<{ validation: GoodsIssueValidation }>(`/${id}/validate`).then((result) => result.validation);
export const postGoodsIssue = (id: string, negativeOverride?: { reasonCode: string; notes: string }) =>
  call<{ detail: GoodsIssueDetail }>(`/${id}/post`, { method: "POST", json: negativeOverride ? { negativeOverride } : {} }).then((result) => result.detail);
export const cancelGoodsIssue = (id: string, reason: string) => call<{ detail: GoodsIssueDetail }>(`/${id}/cancel`, { method: "POST", json: { reason } }).then((result) => result.detail);
export const reverseGoodsIssue = (id: string, input: { reason: string; lines?: Array<{ lineId: string; quantity?: string; serialIds?: string[] }>; idempotencyKey?: string }) =>
  call<{ detail: GoodsIssueDetail }>(`/${id}/reverse`, { method: "POST", json: input }).then((result) => result.detail);
export const listReasons = (includeInactive = false) => call<{ reasons: Reason[] }>(`/reasons${query({ includeInactive: includeInactive ? "true" : undefined })}`).then((result) => result.reasons);
export const createReason = (input: Partial<Reason>) => call<{ reason: Reason }>("/reasons", { method: "POST", json: input }).then((result) => result.reason);
export const updateReason = (id: string, input: Partial<Reason> & { expectedVersion?: number }) => call<{ reason: Reason }>(`/reasons/${id}`, { method: "PATCH", json: input }).then((result) => result.reason);
export const uploadGoodsIssueFile = (id: string, file: File) => { const body = new FormData(); body.append("file", file); return call<{ file: unknown }>(`/${id}/files`, { method: "POST", body }); };
export const removeGoodsIssueFile = (id: string, fileId: string) => call<{ result: unknown }>(`/${id}/files/${fileId}`, { method: "DELETE", json: {} });
export const goodsIssueFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const errorsOf = (error: unknown): Array<{ message: string; code: string }> =>
  error instanceof SalesApiError && Array.isArray((error.payload as { errors?: unknown })?.errors) ? (error.payload as { errors: Array<{ message: string; code: string }> }).errors : [];
export const DISPOSITION_LABEL: Record<string, string> = { available: "Available", quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged", expired: "Expired / blocked", restricted: "Restricted" };
export const STATUS_LABEL: Record<GoodsIssueStatus, string> = { draft: "Draft", posted: "Posted", partially_reversed: "Partly reversed", reversed: "Reversed", cancelled: "Cancelled" };
