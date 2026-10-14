"use client";

// Material Consumption: the client of /api/manufacturing/material-consumptions, /material-consumption-reports and the order's consumable
// materials and material reconciliation.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type ConsumptionStatus = "DRAFT" | "PENDING_APPROVAL" | "POSTING" | "POSTED" | "CANCELLED" | "RECOVERY_REQUIRED";
export type Band = "NO_BASIS" | "WITHIN" | "UNDER" | "WARNING" | "APPROVAL" | "UNPLANNED";
export type ConsumptionLine = {
  id: string; lineNumber: number; materialId: string; itemId: string; code: string; name: string; trackingType: string; origin: string; quantity: string; uomId: string; uom: string;
  baseQuantity: string; baseUom: string; planned: string; extra: string; issued: string; consumed: string; scrapped: string; returned: string; inCustody: string; custodyNow: string | null;
  expected: string | null; variance: string | null; variancePct: string | null; band: Band; bandLabel: string; varianceReason: string | null; notes: string | null;
  batch: { id: string; number: string | null } | null; serials: Array<{ id: string; number: string | null }>; unitCost: string | null; totalCost: string | null; corrected: string;
  allocations: Array<{ id: string; issueNumber: string | null; issueId: string | null; batch: string | null; serial: string | null; quantity: string; unitCost: string | null }>;
};
export type Consumption = {
  id: string; number: string; status: ConsumptionStatus; statusLabel: string; kind: "NORMAL" | "CLOSING"; rowVersion: number; consumptionDate: string; consumedAt: string | null; notes: string | null;
  createdBy: string | null; createdAt: string; postedBy: string | null; postedAt: string | null; supervisor: string | null; cancelledBy: string | null; cancelReason: string | null;
  order: { id: string; number: string; status: string; statusLabel: string; version: number; finishedItem: { code: string; name: string }; revisionNumber: number | null; plannedOutput: string; acceptedOutput: string };
  production: { warehouse: { id: string; code: string; name: string }; location: { id: string; code: string; name: string } | null; entry: { id: string; number: string; reported: string; accepted: string } | null;
    batchReference: string | null; outputBasis: string | null };
  approval: { required: boolean; valid: boolean; stale: boolean; status: string; message?: string | null; reason: string | null; requestedBy: string | null; requestedAt: string | null; decidedBy: string | null;
    decidedAt: string | null; note: string | null };
  policy: { warningPct: string; approvalPct: string };
  lines: ConsumptionLine[]; totals: { quantity: string; cost: string | null; costStatus: string | null };
  posting: { key: string; documentVersion: number; custodyStatus: string; financeStatus: string; at: string; financeNote: string } | null;
  corrections: Array<{ id: string; number: string; lineNumber: number; code: string; quantity: string; reason: string; evidence: string | null; cost: string | null; by: string | null; at: string }>;
  print: { count: number; lastPrintedAt: string | null; watermark: string | null };
  history: Array<{ action: string; label: string; fromStatus: string | null; toStatus: string | null; summary: string | null; actor: string | null; at: string }>;
  can: Record<"edit" | "cancel" | "preview" | "requestApproval" | "decideApproval" | "post" | "correct" | "print" | "viewCost" | "recover", boolean>;
};
export type ConsumptionListRow = {
  id: string; number: string; status: ConsumptionStatus; statusLabel: string; kind: string; orderId: string; orderNumber: string; orderStatusLabel: string; finishedItem: string; lines: number;
  summary: string | null; batchReference: string | null; outputBasis: string | null; hasVariance: boolean; approvalStatus: string; recordedBy: string | null; postedBy: string | null; createdAt: string;
  postedAt: string | null; totalCost: string | null; costStatus: string | null;
};
export type ConsumptionPreview = {
  consumptionId: string; consumptionNumber: string; ok: boolean; checkedAt: string; problems: Array<{ code: string; message: string }>; approval: Consumption["approval"]; policy: { warningPct: string; approvalPct: string };
  lines: Array<{ lineId: string; code: string; uom: string; quantity: string; baseQuantity: string; custodyBefore: string; custodyAfter: string; expected: string | null; variance: string | null;
    variancePct: string | null; band: Band; bandLabel: string; plan: Array<{ issueNumber: string | null; batchId: string | null; serialId: string | null; quantity: string }> }>;
};
export type Consumable = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; orderVersion: number; eligible: boolean; reason: string | null; plannedOutput: string; acceptedOutput: string;
  reportedOutput: string; outputBasis: string | null;
  productionEntries: Array<{ id: string; number: string; reported: string; accepted: string; batchReference: string | null; at: string }>;
  materials: Array<{
    materialId: string; lineNumber: number; itemId: string; code: string; name: string; uomId: string; uom: string; kind: string; origin: string; trackingType: string; planned: string; extra: string;
    issued: string; consumed: string; scrapped: string; returned: string; inCustody: string; suggestion: string | null; reason: string | null;
    identities: Array<{ key: string; batchId: string | null; batch: string | null; expiresOn: string | null; batchUsable: boolean; serialId: string | null; serial: string | null; available: string;
      sources: Array<{ movementId: string; issueNumber: string | null; issueId: string | null; location: string | null; remaining: string }> }>;
  }>;
};
export type Reconciliation = {
  orderId: string; orderNumber: string; orderStatus: string; acceptedOutput: string; reconciled: boolean; unpostedNotes: number; recoveryNotes: number;
  lines: Array<{ materialId: string; code: string; name: string; uom: string; origin: string; planned: string; extra: string; issued: string; consumed: string; scrapped: string; returned: string;
    inCustody: string; reconciled: boolean; expectedForAccepted: string | null; usageVariance: string | null; usageVariancePct: string | null;
    cost: { issued: string; returned: string; consumed: string; scrapped: string | null; inCustody: string | null } | null;
    identities: Array<{ batch: string | null; serial: string | null; issued: string; consumed: string; scrapped: string; returned: string; inCustody: string }> }>;
};
export type ConsumptionInput = {
  manufacturingOrderId?: string; productionLocationId?: string | null; productionEntryId?: string | null; productionBatchReference?: string; outputBasisQuantity?: string | null; notes?: string;
  idempotencyKey?: string; expectedVersion?: number;
  lines: Array<{ materialId: string; quantity: string; uomId?: string; batchId?: string | null; serialIds?: string[]; varianceReason?: string }>;
};

export const CONSUMPTION_TONE: Record<ConsumptionStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", PENDING_APPROVAL: "warning", POSTING: "warning", POSTED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger",
};
export const BAND_TONE: Record<Band, "neutral" | "info" | "success" | "warning" | "danger"> = {
  NO_BASIS: "neutral", WITHIN: "success", UNDER: "info", WARNING: "warning", APPROVAL: "danger", UNPLANNED: "danger",
};
export const MC_BASE = "/manufacturing/material-consumptions";

export const listConsumptions = (filters: Record<string, string | undefined>) => call<{ consumptions: ConsumptionListRow[] }>(`/material-consumptions${qs(filters)}`).then((r) => r.consumptions);
export const getConsumption = (id: string) => call<{ consumption: Consumption }>(`/material-consumptions/${id}`).then((r) => r.consumption);
export const createConsumption = (input: ConsumptionInput) => send<{ consumption: Consumption }>(`/material-consumptions`, input).then((r) => r.consumption);
export const updateConsumption = (id: string, input: ConsumptionInput) => send<{ consumption: Consumption }>(`/material-consumptions/${id}`, input, "PATCH").then((r) => r.consumption);
export const previewConsumption = (id: string) => call<{ preview: ConsumptionPreview }>(`/material-consumptions/${id}/preview`).then((r) => r.preview);
export const consumptionAction = <T = { consumption: Consumption }>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/material-consumptions/${id}/${action}`, input);
export const consumable = (orderId: string, outputQuantity?: string) =>
  call<{ consumable: Consumable }>(`/orders/${orderId}/consumable-materials${qs({ outputQuantity })}`).then((r) => r.consumable);
export const reconciliation = (orderId: string) => call<{ reconciliation: Reconciliation }>(`/orders/${orderId}/material-reconciliation`).then((r) => r.reconciliation);
export const consumptionReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/material-consumption-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
