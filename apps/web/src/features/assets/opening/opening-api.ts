"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/opening: migration batches of existing assets, their rows, Finance review and reports.
export const OPENING_BASE = "/assets/opening";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/opening${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Issue = { field: string | null; code: string; message: string };
export type Match = { assetId: string; code: string; name: string; reason: string; strong: boolean };
export type Batch = { id: string; number: string; source: "FILE" | "MANUAL"; fileName: string | null; cutoverDate: string; status: string; statusLabel: string; rows: number; registered: number; exceptions: number;
  financeMode: string | null; financeOpeningBalanceId: string | null; varianceNote: string | null; createdBy: string | null; createdAt: string; approvedBy: string | null; approvedAt: string | null; closedAt: string | null;
  version: number; href: string };
export type Row = { row: number; status: string; statusLabel: string; name: string | null; existingCode: string | null; category: string | null; serialNumber: string | null; location: string | null;
  lifecycle: string | null; lifecycleLabel: string | null; errors: Issue[]; warnings: Issue[]; matches: Match[]; resolution: string | null; linkAssetId: string | null; assetId: string | null; assetNumber: string | null;
  corrections: Record<string, string>; values?: { cost: string; accumulated: string; carrying: string; remaining: number | null }; raw: Record<string, string> };
export type Position = { id: string; assetId: string; asset: string; currency: string; originalCost: string | null; capitalizedCost: string; accumulatedDepreciation: string; accumulatedImpairment: string;
  otherAdjustments: string; openingCarryingAmount: string; residualValue: string; method: string; remaining: number | null; evidence: string | null; status: string; statusLabel: string; reviewNote: string | null; version: number };
export type BatchDetail = Batch & { counts: Record<string, number>; rows: Row[]; positions: Position[];
  can: { edit: boolean; validate: boolean; register: boolean; cancel: boolean; financials: boolean; approve: boolean; prepare: boolean; close: boolean; correct: boolean; export: boolean; audit: boolean } };
export type Overview = { cutoverDate: string | null; counts: { migrated: number; openBatches: number; pendingFinance: number; rowExceptions: number; needsReview: number };
  totals: { cost: string; accumulatedDepreciation: string; impairment: string; carrying: string } | null; can: { create: boolean; upload: boolean; financials: boolean; approve: boolean } };
export type Reconciliation = { batchId: string; cutoverDate: string; source: "PREPARED" | "POSTED"; totals: { cost: string; accumulated: string; carrying: string; assets: number };
  lines: Array<{ accountId: string; account: string; measure: string; side: string; categories: string[]; register: string; finance: string; variance: string; matched: boolean }>;
  unmapped: Array<{ category: string; measure: string; note: string }>; matched: boolean; note: string };
export type OpeningException = { batch: string; row: number; name: string | null; kind: string; issue: string; href: string };
export type OpeningEvent = { id: string; batch: string; batchId: string; action: string; actionLabel: string; details: Record<string, unknown>; reason: string | null; asset: string | null; by: string | null; at: string };
export type AssetOpening = { migrated: false } | { migrated: true; linked: boolean; batch: string; batchHref: string; row: number; cutoverDate: string; legacyCode: string | null; acquisitionDate: string | null;
  supplier: string | null; purchaseReference: string | null; evidence: string | null;
  position: { currency: string; originalCost: string | null; capitalizedCost: string; accumulatedDepreciation: string; accumulatedImpairment: string; openingCarryingAmount: string; remaining: number | null; status: string; statusLabel: string; version: number } | null;
  corrections: Array<{ action: string; reason: string | null; by: string | null; at: string }>; note: string };

export const getOverview = () => call<Overview>("/actions/overview");
export const getBatches = (status: string) => call<{ rows: Batch[] }>(`/actions/batches${qs({ status })}`).then((r) => r.rows);
export const getBatch = (id: string, filters: Record<string, string | undefined> = {}) => call<BatchDetail>(`/batches/${id}${qs(filters)}`);
export const getReconciliation = (id: string) => call<Reconciliation>(`/actions/reconciliation${qs({ batchId: id })}`);
export const getExceptions = () => call<{ rows: OpeningException[] }>("/actions/exceptions").then((r) => r.rows);
export const getHistory = (batchId?: string) => call<{ rows: OpeningEvent[] }>(`/actions/history${qs({ batchId })}`).then((r) => r.rows);
export const getOpeningReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);
export const batchAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/batches/${id}/${action}`, input);
export const openingAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown>) => send<T>(`/actions/${action}`, input);
export async function uploadOpeningFile(file: File, cutoverDate: string) {
  const form = new FormData();
  form.set("file", file);
  form.set("cutoverDate", cutoverDate);
  return call<{ batchId: string; number?: string; replayed?: boolean }>("/upload", { method: "POST", body: form });
}
export const templateHref = (format: "csv" | "xlsx") => `/api/assets/opening/template${qs({ format })}`;
export const batchExportHref = (id: string) => `/api/assets/opening/batches/${id}/export`;
export const BATCH_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", NEEDS_CORRECTION: "warning", READY_FOR_CONFIRMATION: "info", REGISTERING: "info",
  REGISTERED_PENDING_FINANCE: "warning", RECONCILED: "success", CLOSED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const ROW_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PENDING: "neutral", INVALID: "danger", DUPLICATE: "warning", VALID: "info", REGISTERED: "success", LINKED: "success", SKIPPED: "neutral" };
export const POSITION_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PROPOSED: "info", NEEDS_REVIEW: "warning", APPROVED: "success", LOCKED: "neutral" };
export const OPENING_REPORT_KINDS = [
  { id: "opening-register", label: "Opening asset register" }, { id: "opening-by-category", label: "Migrated assets by category" }, { id: "opening-cost-summary", label: "Opening cost by category", money: true },
  { id: "opening-accumulated-depreciation", label: "Opening accumulated depreciation", money: true }, { id: "opening-carrying-value", label: "Opening carrying value", money: true },
  { id: "fully-depreciated-active", label: "Fully depreciated but still in use", money: true }, { id: "without-purchase-evidence", label: "Without purchase evidence" },
  { id: "migration-duplicates", label: "Possible duplicates" }, { id: "missing-location-custodian", label: "Missing location or custodian" }, { id: "unmatched-historical-codes", label: "Unmatched previous codes" },
  { id: "pending-finance-approval", label: "Waiting for Finance approval" }, { id: "migration-batch-history", label: "Migration batch history" },
];
