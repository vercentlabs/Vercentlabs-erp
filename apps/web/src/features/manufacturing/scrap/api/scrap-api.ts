"use client";

// Manufacturing Scrap: the client of /api/manufacturing/scrap, /scrap-reports and the order's scrappable sources and scrap history.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type ScrapStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTING" | "POSTED" | "CANCELLED" | "RECOVERY_REQUIRED";
export type ScrapType = "ISSUED_MATERIAL" | "REJECTED_OUTPUT";
export type ScrapLine = {
  id: string; lineNumber: number; itemId: string; code: string; name: string; trackingType: string; materialId: string | null; productionEntryId: string | null; entryNumber: string | null;
  productionBatch: string | null; qualityDecisionId: string | null; quantity: string; uomId: string; uom: string; baseQuantity: string; baseUom: string;
  batch: { id: string; number: string | null } | null; serials: Array<{ id: string; number: string | null }>; notes: string | null;
  now: { custody?: string; rejected?: string; undisposed?: string } | null; unitCost: string | null; totalCost: string | null; stockMovementIds: string[];
};
export type ScrapCorrection = { id: string; number: string; status: "REQUESTED" | "APPROVED" | "REJECTED"; reason: string; evidence: string | null; physicallyPresent: boolean; requestedBy: string | null;
  requestedAt: string; decidedBy: string | null; decidedAt: string | null; note: string | null; cost: string | null };
export type ManufacturingScrap = {
  id: string; number: string; status: ScrapStatus; statusLabel: string; rowVersion: number; scrapType: ScrapType; reasonCode: string; reasonLabel: string; description: string | null;
  disposition: "IRRECOVERABLE" | "RECOVERABLE"; lossClass: "NORMAL" | "ABNORMAL"; recoveryValue: string | null; scrapDate: string | null; correctionStatus: "NONE" | "REQUESTED" | "REVERSED" | "REJECTED";
  createdBy: string | null; createdAt: string; postedBy: string | null; postedAt: string | null; cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null;
  order: { id: string; number: string; status: string; statusLabel: string; version: number; finishedItem: { code: string; name: string }; snapshotId: string | null };
  source: { warehouse: { id: string; code: string; name: string } | null };
  destination: { warehouse: { id: string; code: string; name: string } | null; location: { id: string; code: string; name: string; disposition: string } | null } | null;
  approval: { required: boolean; reasons: string[]; valid: boolean; status: string; requestedBy: string | null; requestedAt: string | null; decidedBy: string | null; decidedAt: string | null;
    note: string | null; stale: boolean };
  lines: ScrapLine[]; totals: { lines: number; cost: string | null; financeStatus: string | null };
  posting: { key: string; inventoryStatus: string; stockMovementIds: string[]; financeStatus: string; journalEntryId: string | null; at: string } | null;
  corrections: ScrapCorrection[];
  print: { count: number; lastPrintedAt: string | null; watermark: string | null };
  history: Array<{ action: string; label: string; fromStatus: string | null; toStatus: string | null; summary: string | null; actor: string | null; at: string }>;
  can: Record<"edit" | "cancel" | "submit" | "decide" | "post" | "requestCorrection" | "decideCorrection" | "print" | "viewCost" | "recover", boolean>;
};
export type ScrapListRow = {
  id: string; number: string; status: ScrapStatus; statusLabel: string; scrapType: ScrapType; reasonCode: string; reasonLabel: string; disposition: string; lossClass: string; correctionStatus: string;
  approvalStatus: string; orderId: string; orderNumber: string; orderStatusLabel: string; finishedItem: string; summary: string | null; location: string | null; createdBy: string | null;
  postedBy: string | null; createdAt: string; postedAt: string | null; totalCost: string | null; printed: number;
};
export type ScrapPreview = {
  scrapId: string; scrapNumber: string; ok: boolean; readiness: "READY_TO_POST" | "PENDING_APPROVAL" | "BLOCKED"; checkedAt: string; problems: Array<{ code: string; message: string }>;
  approval: { required: boolean; reasons: string[]; valid: boolean }; cost: { status: string; total: string | null; treatment: string } | null;
  lines: Array<{ lineNumber: number; quantity: string; value: string | null }>;
};
export type ScrapSources = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; orderVersion: number;
  material: { eligible: boolean; reason: string | null }; output: { eligible: boolean; reason: string | null };
  policy: { valueAbove: string | null; outputRequiresApproval: boolean; abnormalRequiresApproval: boolean };
  finishedItem: { id: string; code: string; name: string; tracking_type: string; uom: string; uomId: string };
  reasons: Array<{ value: string; label: string }>; bins: Array<{ id: string; code: string; name: string; disposition: string; warehouse: string }>;
  materials: Array<{ materialId: string; itemId: string; code: string; name: string; uomId: string; uom: string; trackingType: string; netIssued: string; consumed: string; scrapped: string; returned: string;
    inCustody: string; identities: Array<{ id: string; label: string; kind: "batch" | "serial"; available: string }> }>;
  entries: Array<{ id: string; number: string; batch: string | null; producedAt: string | null; reported: string; accepted: string; rejected: string; scrapped: string; undisposed: string; qualityDisposition: string | null }>;
};
export type ScrapPostingCheck = { scrapId: string; scrapNumber: string; status: string; consistent: boolean; problems: string[]; checkedAt: string;
  inventory: { status: string; movements: number }; finance: { status: string; amount: string | null } };
export type ScrapException = { kind: "APPROVAL_PENDING" | "APPROVED_NOT_POSTED" | "CORRECTION_PENDING" | "POSTING_MISMATCH" | "REJECTED_NOT_DISPOSED"; scrapId: string | null; scrapNumber: string | null;
  orderId: string; orderNumber: string | null; since: string | null; message: string };
export type ScrapDraftInput = {
  manufacturingOrderId?: string; scrapType?: ScrapType; reasonCode?: string; description?: string | null; disposition?: string; lossClass?: string; destinationLocationId?: string | null;
  recoveryValue?: string | null; scrapDate?: string | null; idempotencyKey?: string; expectedVersion?: number;
  lines: Array<{ materialId?: string; productionEntryId?: string; quantity: string; uomId?: string; batchId?: string | null; serialIds?: string[] }>;
};

export const SCRAP_TONE: Record<ScrapStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", PENDING_APPROVAL: "warning", APPROVED: "info", POSTING: "warning", POSTED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger",
};
export const SCRAP_BASE = "/manufacturing/scrap";
export const TYPE_LABEL: Record<ScrapType, string> = { ISSUED_MATERIAL: "Issued material", REJECTED_OUTPUT: "Rejected output" };

export const listScraps = (filters: Record<string, string | undefined>) => call<{ scraps: ScrapListRow[] }>(`/scrap${qs(filters)}`).then((r) => r.scraps);
export const getScrap = (id: string) => call<{ scrap: ManufacturingScrap }>(`/scrap/${id}`).then((r) => r.scrap);
export const createScrap = (input: ScrapDraftInput) => send<{ scrap: ManufacturingScrap }>(`/scrap`, input).then((r) => r.scrap);
export const updateScrap = (id: string, input: ScrapDraftInput) => send<{ scrap: ManufacturingScrap }>(`/scrap/${id}`, input, "PATCH").then((r) => r.scrap);
export const previewScrap = (id: string) => call<{ preview: ScrapPreview }>(`/scrap/${id}/preview`).then((r) => r.preview);
export const scrapPostingStatus = (id: string) => call<{ posting: ScrapPostingCheck }>(`/scrap/${id}/posting-status`).then((r) => r.posting);
export const scrapAction = <T = { scrap: ManufacturingScrap }>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/scrap/${id}/${action}`, input);
export const scrapSources = (orderId: string) => call<{ sources: ScrapSources }>(`/orders/${orderId}/scrap?view=sources`).then((r) => r.sources);
export const scrapExceptions = () => call<{ exceptions: ScrapException[] }>(`/scrap/exceptions`).then((r) => r.exceptions);
export const scrapReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/scrap-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
