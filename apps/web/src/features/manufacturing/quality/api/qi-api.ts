"use client";

// Production Quality Inspection: the client of /api/manufacturing/quality-inspections, /quality-templates, /quality-holds, /quality-reports and the
// order's quality (/orders/<id>/quality).
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type QiStatus = "DRAFT" | "IN_PROGRESS" | "PENDING_REVIEW" | "FINALIZED" | "CANCELLED" | "RECOVERY_REQUIRED";
export type CriterionType = "PASS_FAIL" | "NUMERIC" | "TEXT" | "CHOICE";
export type Criterion = {
  key: string; name: string; type: CriterionType; unit: string | null; lower: string | null; upper: string | null; choices: string[]; acceptedChoices: string[]; required: boolean;
  critical: boolean; instructions: string | null; sequence?: number;
};
export type QiCheck = Criterion & { value: string | null; numericValue: string | null; result: "PASS" | "FAIL" | "NA" | null; problem: string | null; notes: string | null };
export type QiDefect = { id: string; reasonCode: string; reasonLabel: string; severity: "MINOR" | "MAJOR" | "CRITICAL"; affectedQuantity: string; observation: string | null };
export type QiProblem = { code: string; message: string };
export type QualityInspection = {
  id: string; number: string; status: QiStatus; statusLabel: string; rowVersion: number; stage: "FINAL" | "IN_PROCESS"; samplingBasis: "FULL" | "SAMPLE" | "BATCH_POLICY";
  order: { id: string; number: string; status: string; statusLabel: string };
  entry: { id: string; number: string | null; rowVersion: number | null; batch: string | null };
  item: { id: string; code: string | null; name: string | null }; uom: string | null; location: { code: string; name: string } | null;
  template: { id: string; number: string; name: string; revision: number; current: boolean } | null;
  quantities: { scope: string; entered: string; enteredUom: string | null; examined: string; accepted: string; rejected: string; held: string; undecided: string; available: string | null };
  checks: QiCheck[]; defects: QiDefect[];
  decision: { rejectionReason: string | null; rejectionDisposition: "QUARANTINE" | "REWORK" | "SCRAP" | null; reworkAssignedTo: string | null; holdReason: string | null;
    deviationRequested: boolean; deviation: boolean; qualityDecisionId: string | null };
  problems: QiProblem[]; criticalFailure: boolean;
  review: { required: boolean; reasons: string[]; approved: boolean; decision: "APPROVED" | "RETURNED" | null; note: string | null; submittedBy: string | null; submittedAt: string | null;
    reviewer: string | null; reviewedAt: string | null; stale: boolean };
  hold: { id: string; quantity: string; reason: string; status: "ACTIVE" | "RELEASED"; releasedBy: string | null; releasedAt: string | null; note: string | null } | null;
  corrections: Array<{ id: string; number: string; direction: string; kind: string; quantity: string; reason: string; by: string | null; at: string }>;
  notes: string | null; inspector: string | null; inspectedAt: string; createdAt: string; finalizedBy: string | null; finalizedAt: string | null; finalizeKey: string | null;
  cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null;
  print: { count: number; lastPrintedAt: string | null; watermark: string | null };
  history: Array<{ action: string; label: string; fromStatus: string | null; toStatus: string | null; summary: string | null; actor: string | null; at: string }>;
  can: Record<"record" | "cancel" | "submit" | "review" | "finalize" | "reinspect" | "releaseHold" | "correct" | "print" | "recover" | "attach", boolean>;
  reporterBlocked: boolean;
};
export type QiListRow = {
  id: string; number: string; status: QiStatus; statusLabel: string; stage: string; orderId: string; orderNumber: string; entryId: string; entryNumber: string; batch: string | null;
  itemCode: string; itemName: string; uom: string | null; scope: string; examined: string; accepted: string; rejected: string; held: string; disposition: string | null; defects: number;
  inspector: string | null; inspectedAt: string; finalizedAt: string | null; reviewPending: boolean;
};
export type QiQueueRow = {
  entryId: string; entryNumber: string; orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; itemId: string; itemCode: string; itemName: string; uom: string | null;
  batch: string | null; pending: string; held: string; available: string; reportedAt: string | null; ageHours: number | null; openInspections: number; openInspectionId: string | null;
  hasChecklist: boolean; reportedByMe: boolean;
};
export type QiHold = { id: string; entryId: string; entryNumber: string; inspectionId: string | null; inspectionNumber: string | null; quantity: string; reason: string; status: "ACTIVE" | "RELEASED";
  placedBy: string | null; placedAt: string; releasedBy: string | null; releasedAt: string | null; note: string | null };
export type MoQuality = {
  orderId: string; orderNumber: string; orderStatus: string; hasChecklist: boolean; templateRequired: boolean; reviewRequired: boolean;
  totals: { reported: string; pending: string; held: string; accepted: string; rejected: string; received: string; scrapped: string; rejectionRatePct: string | null };
  entries: Array<{ id: string; number: string; status: string; batch: string | null; rowVersion: number; reported: string; pending: string; held: string; available: string; accepted: string;
    rejected: string; received: string; receivable: string; scrapped: string; undisposed: string; reportedByMe: boolean }>;
  inspections: QiListRow[]; holds: QiHold[];
  corrections: Array<{ id: string; number: string; entryNumber: string; direction: string; kind: string; quantity: string; reason: string; disposition: string | null; by: string | null; at: string }>;
  can: Record<"inspect" | "hold" | "releaseHold" | "reinspect" | "correct", boolean>;
};
export type QiTemplateRow = { id: string; number: string; name: string; stage: "FINAL" | "IN_PROCESS"; status: "ACTIVE" | "INACTIVE"; itemId: string | null; itemCode: string | null; itemName: string | null;
  revision: number | null; checks: number; critical: number; used: number; updatedAt: string };
export type QiTemplate = {
  id: string; number: string; name: string; stage: "FINAL" | "IN_PROCESS"; status: "ACTIVE" | "INACTIVE"; item: { id: string; code: string; name: string } | null; createdBy: string | null;
  createdAt: string; criteria: Criterion[]; revision: number | null;
  revisions: Array<{ id: string; revision: number; status: "ACTIVE" | "SUPERSEDED"; checks: number; notes: string | null; createdBy: string | null; createdAt: string; supersededAt: string | null; criteria: Criterion[] }>;
  can: { manage: boolean };
};
export type QiException = { kind: "REVIEW" | "RECOVERY" | "STALE" | "HOLD"; inspectionId?: string; inspectionNumber?: string; holdId?: string; orderId: string; orderNumber: string; itemCode: string;
  since: string; summary: string };
export type QiFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export type QiRecordInput = {
  expectedVersion?: number; results?: Array<{ key: string; value: string | null; notes?: string | null }>;
  defects?: Array<{ reasonCode: string; severity: string; affectedQuantity: string; observation?: string | null }>;
  acceptedQuantity?: string | null; rejectedQuantity?: string | null; holdQuantity?: string | null; examinedQuantity?: string | null; rejectionReason?: string | null;
  rejectionDisposition?: string | null; reworkAssignedTo?: string | null; holdReason?: string | null; deviationRequested?: boolean; notes?: string | null;
};

export const QI_BASE = "/manufacturing/quality-inspections";
export const QI_TEMPLATES_BASE = "/manufacturing/quality-checklists";
export const QI_TONE: Record<QiStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", IN_PROGRESS: "info", PENDING_REVIEW: "warning", FINALIZED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger",
};
export const DISPOSITION_LABEL: Record<string, string> = { QUARANTINE: "Quarantine", REWORK: "Rework", SCRAP: "Scrap" };
export const TYPE_LABEL: Record<CriterionType, string> = { PASS_FAIL: "Pass / fail", NUMERIC: "Measurement", TEXT: "Observation", CHOICE: "Choice" };
export const DEFECT_REASONS = ["SCRATCH", "DENT", "CRACK", "WRONG_DIMENSION", "LOOSE_FITTING", "MISSING_PART", "FINISH_DEFECT", "CONTAMINATION", "LABEL_ERROR", "FUNCTIONAL_FAILURE", "OTHER"];
export const reasonLabel = (code: string) => code.toLowerCase().replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

export const listInspections = (filters: Record<string, string | undefined>) => call<{ inspections: QiListRow[] }>(`/quality-inspections${qs(filters)}`).then((r) => r.inspections);
export const inspectionQueue = (filters: Record<string, string | undefined> = {}) => call<{ queue: QiQueueRow[] }>(`/quality-inspections/queue${qs(filters)}`).then((r) => r.queue);
export const qualityExceptions = () => call<{ exceptions: QiException[] }>(`/quality-inspections/exceptions`).then((r) => r.exceptions);
export const getInspection = (id: string) => call<{ inspection: QualityInspection }>(`/quality-inspections/${id}`).then((r) => r.inspection);
export const createInspection = (input: Record<string, unknown>) => send<{ inspection: QualityInspection }>(`/quality-inspections`, input).then((r) => r.inspection);
export const recordInspection = (id: string, input: QiRecordInput) => send<{ inspection: QualityInspection }>(`/quality-inspections/${id}`, input, "PATCH").then((r) => r.inspection);
export const inspectionAction = <T = { inspection: QualityInspection }>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/quality-inspections/${id}/${action}`, input);
export const inspectionFiles = (id: string) => call<{ files: QiFile[] }>(`/quality-inspections/${id}/files`).then((r) => r.files);
export const removeInspectionFile = (id: string, fileId: string) => send(`/quality-inspections/${id}/files/${fileId}`, {}, "DELETE");
export async function uploadInspectionFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: QiFile }>(`/quality-inspections/${id}/files`, { method: "POST", body: form, headers: { Accept: "application/json" } }).then((r) => r.file);
}
export const holdAction = <T = Record<string, unknown>>(holdId: string, action: "release" | "reinspect", input: Record<string, unknown> = {}) => send<T>(`/quality-holds/${holdId}/${action}`, input);
export const orderQuality = (orderId: string) => call<{ quality: MoQuality }>(`/orders/${orderId}/quality`).then((r) => r.quality);
export const placeHold = (orderId: string, input: Record<string, unknown>) => send(`/orders/${orderId}/quality/hold`, input);
export const correctQuality = (orderId: string, input: Record<string, unknown>) => send(`/orders/${orderId}/quality/correct`, input);
export const listTemplates = (filters: Record<string, string | undefined> = {}) => call<{ templates: QiTemplateRow[] }>(`/quality-templates${qs(filters)}`).then((r) => r.templates);
export const getTemplate = (id: string) => call<{ template: QiTemplate }>(`/quality-templates/${id}`).then((r) => r.template);
export const createTemplate = (input: Record<string, unknown>) => send<{ template: QiTemplate }>(`/quality-templates`, input).then((r) => r.template);
export const reviseTemplate = (id: string, input: Record<string, unknown>) => send<{ template: QiTemplate }>(`/quality-templates/${id}/revisions`, input).then((r) => r.template);
export const setTemplateStatus = (id: string, status: "ACTIVE" | "INACTIVE") => send<{ template: QiTemplate }>(`/quality-templates/${id}`, { status }, "PATCH").then((r) => r.template);
export const qualityReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/quality-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
