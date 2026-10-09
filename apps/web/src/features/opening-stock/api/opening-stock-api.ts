"use client";

// Browser client for Opening Stock under /api/inventory/opening-stock.
import { SalesApiError } from "@/features/sales/shared/http";

export type OpeningStatus = "draft" | "posted" | "cancelled" | "reversed";
export type Disposition = "available" | "quality_hold" | "quarantined" | "damaged";
export type OpeningCapabilities = Record<"view" | "prepare" | "viewCost" | "editCost" | "post" | "reverse" | "zeroCost" | "backdate" | "reconcile", boolean>;

export type OpeningLine = {
  id: string; lineNumber: number; itemId: string; sku: string; itemName: string; trackingType: "none" | "batch" | "serial"; locationId: string; locationCode: string;
  quantity: number; uomId: string; uomCode: string; conversionFactor: number; baseQuantity: number; baseUomCode: string | null; disposition: Disposition; dispositionLabel: string;
  batchNumber: string | null; manufacturedOn: string | null; expiresOn: string | null; serialNumbers: string[]; notes: string | null;
  unitCost?: number | null; baseUnitCost?: number | null; value?: number;
};
export type ImportReport = {
  id: string; fileName: string; status: "validated" | "applied" | "rejected"; rows: number; valid: number; warnings: number; errors: number;
  report: Array<{ rowNumber: number; sku: string; outcome: string; message: string | null }>; uploadedAt: string;
};
export type AccountingStatus = {
  status: "not_posted" | "reconciled" | "needs_reconciliation" | "reversed"; label: string; inventoryValue?: number; financeValue?: number; difference?: number;
  journalNumber?: string | null; reversalJournalNumber?: string | null;
};
export type OpeningFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export type HistoryEntry = { id: string; eventType: string; summary: string; reason: string | null; actorName: string | null; createdAt: string };
export type OpeningSummary = {
  id: string; number: string; warehouseId: string; warehouseCode: string; warehouseName: string; openingDate: string; accountingDate: string; currencyCode: string;
  migrationReference: string; sourceSystem: string | null; externalReference: string | null; notes: string | null; status: OpeningStatus; statusLabel: string; items: number; lines: number;
  value?: number; journalEntryId: string | null; journalNumber: string | null; reversalJournalNumber: string | null; zeroCostReason: string | null; cancelReason: string | null;
  reversalReason: string | null; createdBy: string | null; createdAt: string; postedBy: string | null; postedAt: string | null; version: number;
};
export type OpeningDocument = OpeningSummary & {
  lineItems: OpeningLine[]; imports: ImportReport[]; accounting: AccountingStatus | null; files: OpeningFile[]; history: HistoryEntry[]; capabilities: OpeningCapabilities;
};
export type Finding = { code: string; message: string; line?: number };
export type Validation = {
  errors: Finding[]; warnings: Finding[];
  summary: { warehouse: string; items: number; lines: number; batches: number; serials: number; value?: number; zeroCostLines: number; expiredBatches: number };
};
export type OpeningOptions = {
  warehouses: Array<{ id: string; code: string; name: string }>; dispositions: Array<{ code: Disposition; label: string }>; currencyCode: string; today: string; capabilities: OpeningCapabilities;
};
export type Reconciliation = { inventoryValue: number; financeValue: number; difference: number; status: "reconciled" | "needs_reconciliation"; label: string };
export type MigrationBatch = ImportReport & { documentId: string | null; documentNumber: string | null; warehouseCode: string; migrationReference: string; uploadedBy: string | null };
export type ImportResult = { dryRun: boolean; status: string; rows: number; valid: number; warnings: number; errors: number; lines: number; results: ImportReport["report"] };
export type LineInput = {
  id?: string; itemId: string; locationId?: string | null; quantity: string; uomId?: string | null; unitCost?: string | null; disposition?: Disposition; batchNumber?: string | null;
  manufacturedOn?: string | null; expiresOn?: string | null; serialNumbers?: string[]; notes?: string | null;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/opening-stock";
function call<T>(path: string, init?: { method?: string; json?: unknown; form?: FormData }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.form ?? (init?.json !== undefined ? JSON.stringify(init.json) : undefined),
  }).then(parse<T>);
}
const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listOpeningStocks = (filters: { view?: string; search?: string; warehouseId?: string } = {}) =>
  call<{ documents: OpeningSummary[]; capabilities: OpeningCapabilities }>(query(filters));
export const getOpeningOptions = () => call<OpeningOptions>("/options");
export const listMigrationBatches = () => call<{ imports: MigrationBatch[] }>("/imports").then((result) => result.imports);
export const getReconciliation = () => call<{ reconciliation: Reconciliation }>("/reconciliation").then((result) => result.reconciliation);
export const templateUrl = `${BASE}/template`;
export const getOpeningStock = (id: string) => call<{ document: OpeningDocument }>(`/${id}`).then((result) => result.document);
export const createOpeningStock = (input: Record<string, unknown>) => call<{ document: OpeningDocument }>("", { method: "POST", json: input }).then((result) => result.document);
export const updateOpeningStock = (id: string, input: Record<string, unknown>) =>
  call<{ document: OpeningDocument }>(`/${id}`, { method: "PATCH", json: input }).then((result) => result.document);
export const validateOpeningStock = (id: string) => call<{ validation: Validation }>(`/${id}/validate`, { method: "POST", json: {} }).then((result) => result.validation);
export const postOpeningStock = (id: string, input: { acknowledgeBackdated?: boolean; zeroCostReason?: string; expectedVersion?: number }) =>
  call<{ document: OpeningDocument }>(`/${id}/post`, { method: "POST", json: input }).then((result) => result.document);
export const cancelOpeningStock = (id: string, reason?: string) => call<{ document: OpeningDocument }>(`/${id}/cancel`, { method: "POST", json: { reason } }).then((result) => result.document);
export const getReversalBlockers = (id: string) => call<{ blockers: Finding[] }>(`/${id}/reverse`).then((result) => result.blockers);
export const reverseOpeningStock = (id: string, reason: string) => call<{ document: OpeningDocument }>(`/${id}/reverse`, { method: "POST", json: { reason } }).then((result) => result.document);
export const importOpeningStockFile = (id: string, file: File, dryRun: boolean) => {
  const form = new FormData();
  form.append("file", file);
  form.append("dryRun", dryRun ? "true" : "false");
  return call<{ result: ImportResult }>(`/${id}/import`, { method: "POST", form }).then((result) => result.result);
};
export const uploadOpeningFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: OpeningFile }>(`/${id}/files`, { method: "POST", form }).then((result) => result.file);
};
export const removeOpeningFile = (id: string, fileId: string) => call<{ result: { removed: boolean } }>(`/${id}/files/${fileId}`, { method: "DELETE", json: {} });
export const openingFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;

type Issue = { field: string; message: string };
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = error instanceof SalesApiError ? (error.payload?.issues as Issue[] | undefined) : undefined;
  return Object.fromEntries((issues ?? []).map((issue) => [issue.field, issue.message]));
}
export const findingsOf = (error: unknown) => (error instanceof SalesApiError ? (error.payload?.errors as Finding[] | undefined) ?? [] : []);
