"use client";

// Partial Production: the client of /api/manufacturing/orders/[id]/{production, receivable-output, production-readiness, production-history,
// production-entry-drafts, production-batches, overproduction-requests, request-short-close, decide-short-close}, /production-entries and
// /production-reports.
import { call, orderAction, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type EntryRow = {
  id: string; number: string; status: "DRAFT" | "REPORTED" | "CANCELLED" | "RECOVERY_REQUIRED"; statusLabel: string; batchId: string | null; batch: string | null; entered: string | null; uom: string | null;
  reported: string; accepted: string; rejected: string; pending: string; received: string; receivable: string; correctedPending: string; correctedAccepted: string;
  inspection: string; receipt: string; producedAt: string | null; postedAt: string | null; postedBy: string | null; notes: string | null; rejectionReason: string | null; materialOverride: string | null;
  rowVersion: number; orderId?: string; orderNumber?: string; product?: string; recordedBy?: string | null;
};
export type Progress = {
  orderId: string; orderNumber: string; status: string; statusLabel: string; version: number;
  quantities: { planned: string; authorizedTarget: string; overproductionAllowance: string; tolerancePct: string; reported: string; pending: string; accepted: string; rejected: string; received: string;
    acceptedNotReceived: string; remaining: string; shortfall: string | null; progressPct: string | null; yieldPct: string | null };
  reconciled: boolean;
  batches: Array<{ id: string; reference: string; status: "OPEN" | "CLOSED"; location: string | null; planned: string | null; startedAt: string; endedAt: string | null; entries: number; reported: string;
    accepted: string; rejected: string; pending: string; received: string; receivable: string; consumptionRecorded: boolean; materials: Array<{ code: string; expected: string; consumed: string; variance: string }> }>;
  entries: EntryRow[]; drafts: EntryRow[];
  overproduction: Array<{ id: string; quantity: string; reason: string; status: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null; note: string | null; mayDecide: boolean }>;
  shortClose: { requestedBy: string | null; requestedAt: string; reason: string | null; pending: boolean; mayDecide: boolean } | null;
  can: Record<"record" | "draft" | "openBatch" | "decideQuality" | "receive" | "requestOverproduction" | "requestShortClose" | "correct" | "export" | "viewCost", boolean>;
};
export type Readiness = { orderId: string; batchQuantity: string; previewOnly: true; eligible: boolean; ready: boolean; staged: boolean; productionReady: boolean; cumulative: string; note: string;
  lines: Array<{ materialId: string; code: string; name: string; uom: string; requiredForCumulative: string; batchExpected: string | null; issued: string; consumed: string; inCustody: string; reserved: string;
    short: string; status: "ISSUED" | "RESERVED" | "SHORT" }> };
export type Entry = EntryRow & {
  order: { id: string; number: string; status: string; statusLabel: string; version: number; finishedItem: { code: string; name: string }; planned: string };
  batch: { id: string; reference: string; status: string; planned: string | null; location: string | null } | null; location: { code: string; name: string } | null;
  recordedBy: string | null; recordedAt: string; cancelledBy: string | null; cancelReason: string | null; split: { accepted: string; rejected: string; pending: string };
  expectedMaterials: Array<{ code: string; expected: string; uom: string }>; consumptionNotes: Array<{ id: string; number: string; status: string }>;
  decisions: Array<{ id: string; accepted: string; rejected: string; reason: string | null; reasonCode: string | null; disposition: string | null; inspectionReference: string | null; by: string | null; at: string }>;
  receipts: Array<{ id: string; number: string; quantity: string; warehouse: string; batch: string | null; at: string; unitCost: string | null }>;
  corrections: Array<{ id: string; number: string; kind: string; quantity: string; reason: string; evidence: string | null; by: string | null; at: string }>;
  history: Array<{ action: string; summary: string | null; actor: string | null; at: string }>;
  print: { count: number; watermark: string | null };
  can: Record<"edit" | "cancel" | "post" | "decideQuality" | "receive" | "correct" | "print", boolean>;
};

export const ENTRY_TONE: Record<EntryRow["status"], "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "info", REPORTED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const INSPECTION_LABEL: Record<string, string> = { PENDING: "Awaiting inspection", PARTIALLY_INSPECTED: "Partly inspected", ACCEPTED: "Accepted", PARTIALLY_ACCEPTED: "Partly accepted", REJECTED: "Rejected", NONE: "—" };
export const RECEIPT_LABEL: Record<string, string> = { NONE: "—", NOT_RECEIVED: "Not received", PARTIALLY_RECEIVED: "Partly received", RECEIVED: "Received" };
export const DISPOSITIONS = [{ value: "QUARANTINE", label: "Quarantine (decide later)" }, { value: "SCRAP", label: "Scrap" }, { value: "REWORK", label: "Rework" }];
export const PE_BASE = "/manufacturing/production-entries";

export const productionProgress = (orderId: string) => call<{ production: Progress }>(`/orders/${orderId}/production`).then((r) => r.production);
export const readiness = (orderId: string, quantity: string) => call<{ readiness: Readiness }>(`/orders/${orderId}/production-readiness${qs({ quantity })}`).then((r) => r.readiness);
export const openBatch = (orderId: string, input: Record<string, unknown>) => orderAction<{ batch: { id: string } }>(orderId, "production-batches", input);
export const closeBatch = (orderId: string, batchId: string) => send<{ batch: unknown }>(`/orders/${orderId}/production-batches/${batchId}/close`, {});
export const createEntryDraft = (orderId: string, input: Record<string, unknown>) => orderAction<{ entry: { id: string } }>(orderId, "production-entry-drafts", input);
export const requestOverproduction = (orderId: string, input: Record<string, unknown>) => orderAction(orderId, "overproduction-requests", input);
export const decideOverproduction = (orderId: string, requestId: string, input: Record<string, unknown>) => send(`/orders/${orderId}/overproduction-requests/${requestId}`, input);
export const shortClose = (orderId: string, action: "request-short-close" | "decide-short-close", input: Record<string, unknown>) => orderAction(orderId, action, input);
export const listEntries = (filters: Record<string, string | undefined>) => call<{ entries: EntryRow[] }>(`/production-entries${qs(filters)}`).then((r) => r.entries);
export const getEntry = (id: string) => call<{ entry: Entry }>(`/production-entries/${id}`).then((r) => r.entry);
export const updateEntry = (id: string, input: Record<string, unknown>) => send<{ entry: Entry }>(`/production-entries/${id}`, input, "PATCH").then((r) => r.entry);
export const entryAction = (id: string, action: string, input: Record<string, unknown> = {}) => send<{ entry: Entry }>(`/production-entries/${id}/${action}`, input).then((r) => r.entry);
export const productionReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/production-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
