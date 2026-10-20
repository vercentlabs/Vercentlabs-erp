"use client";

// Quality — the client of the inspection workspaces (one shared inspection engine; incoming, in-process, final and pre-dispatch sources):
// the queues and their counts, one inspection (samples, observations, reviews, dispositions, inventory, production or delivery status,
// evidence, history), every workflow action, the dashboard, options and the reports.
import { SpecApiError, qs } from "../specifications/spec-api";

export type Kind = "incoming" | "in_process" | "final" | "pre_dispatch";
export const KIND = Object.freeze({
  incoming: { base: "/quality/incoming", api: "/incoming-inspections", reports: "/reports/incoming-inspections", key: "incoming", title: "Incoming Inspections", noun: "incoming inspection" },
  in_process: { base: "/quality/in-process", api: "/in-process-inspections", reports: "/reports/in-process-inspections", key: "in-process", title: "In-Process Inspections", noun: "in-process inspection" },
  final: { base: "/quality/final", api: "/final-inspections", reports: "/reports/final-inspections", key: "final", title: "Final Inspections", noun: "final inspection" },
  pre_dispatch: { base: "/quality/dispatch", api: "/dispatch-inspections", reports: "/reports/dispatch-inspections", key: "dispatch", title: "Pre-Dispatch Inspections", noun: "pre-dispatch inspection" },
});
export const INCOMING_BASE = KIND.incoming.base;
export const INPROCESS_BASE = KIND.in_process.base;
export const FINAL_BASE = KIND.final.base;
export const DISPATCH_BASE = KIND.pre_dispatch.base;
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/quality${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SpecApiError(payload.message || "The request could not be completed.", response.status, payload.details?.code ?? payload.code, payload.details ?? payload);
  return payload as T;
}

export type Option = { value: string; label: string };
export type Production = { orderId: string; order: string; entryId: string | null; entry: string | null; run: string | null; operation: string | null; checkpoint: string; location: string | null;
  reworkPending: boolean; reworkInstruction: string | null };
export type DeliveryRef = { id: string; number: string; order: string; orderId: string; customer: string | null; checkpoint: string };
export type Row = { id: string; number: string; status: string; statusLabel: string; disposition: string; proposed: string | null; criticalFailure: boolean; priority: string;
  dueAt: string | null; overdue: boolean; item: { id: string; code: string; name: string } | null; supplier: string | null; warehouse: string | null;
  receipt: { number: string; line: number | null } | null; purchaseOrder: { id: string; number: string } | null; unit: string | null; batch: string | null;
  quantity: number; samples: number | null; accepted: number | null; rejected: number | null; inspector: { id: string; name: string } | null;
  reinspectionOf: { id: string; number: string } | null; sourceReversed: boolean; createdAt: string; completedAt: string | null; type: string; production: Production | null;
  delivery: DeliveryRef | null };
export type Characteristic = { id: string; code: string; name: string; checkType: string; criterion: string; instructions: string | null; unit: string | null; criticality: string;
  required: boolean; allowNa: boolean; evidenceRequired: boolean; instrument: string | null; choices: Array<{ value: string; label: string; acceptable: boolean }>; expected: boolean | null };
export type Sample = { id: string; code: string; sequence: number; scope: string; serialNumber: string | null; method: string; selectedBy: string | null; selectedAt: string };
export type Observation = { id: string; sampleId: string; characteristicId: string; value: string | null; unit: string | null; judgement: string | null; notApplicable: boolean;
  naReason: string | null; outcome: string; outcomeLabel: string; reason: string | null; measured: string | null; evidence: string[]; instrument: string | null; notes: string | null;
  amendment: string | null; recordedBy: string | null; recordedAt: string; current: boolean };
export type Evaluation = { proposed: string | null; incomplete: number; criticalFail: boolean; majorDefects: number; minorDefects: number; failedSamples: number; sampleCount: number;
  failed: Array<{ id: string; name: string; criticality: string; samples: number }>; missingEvidence: string[]; needsJudgement: number; rule: string; evaluatedAt: string };
export type Disposition = { id: string; number: string; decision: string; label: string; accept: number; conditional: number; reject: number; reinspect: number; rework: number;
  reworkInstruction: string | null; manufacturingDecision: boolean; hold: number; route: string | null; reason: string; conditions: string | null; evidence: string | null;
  nonconformance: { id: string; number: string } | null; reinspection: { id: string; number: string } | null; rejection: { id: string; number: string } | null; decidedBy: string | null; decidedAt: string };
export type InventoryStatus = { receipt: { id: string; number: string; line: number } | null; held: number | null; released: number | null; returned: number | null; disposed: number | null;
  blocked: number | null; stillHeld: number | null; cleared: number | null; awaitingRelease: number | null;
  requirement: { status: string; controlled: number; label: string | null; blocking: boolean } | null; hold: { id: string; number: string; status: string; unresolved: number } | null };
export type ProductionStatus = {
  order: { id: string; number: string; status: string; reported: number; accepted: number; rejected: number; awaitingInspection: number } | null;
  entry: { id: string; number: string; status: string; reported: number; awaitingInspection: number; held: number; corrected: number; acceptedByManufacturing: number; scrapped: number; rejected: number; received: number | null; lot: string | null } | null;
  run: { id: string; reference: string; status: string; setupConfirmedAt: string | null } | null;
  context: { operation: string | null; checkpoint: string; sequence: number | null; location: string | null; produced: number; cumulative: number | null; operator: string | null;
    reworkRequired: boolean; reworkInstruction: string | null; reworkReference: string | null; reworkCompletedAt: string | null };
  gate: { requirement: string; status: string; label: string | null; blocking: boolean; controlled: number; cleared: number; awaitingAcceptance: number; scope: "RUN" | "OUTPUT" } | null;
};
export type DispatchStatus = {
  delivery: { id: string; number: string; status: string; statusLabel: string; dispatchedAt: string | null; lineQuantity: number | null } | null;
  context: { order: string; orderId: string; customer: string | null; checkpoint: string; inspected: number | null };
  gate: { requirement: string | null; status: string; label: string | null; blocking: boolean; controlled: number; cleared: number; rejected: number; shippable: number | null; blockedNow: number | null } | null;
  holds: Array<{ id: string; number: string; status: string; disposition: string; rejected: number; unresolved: number }>;
};
export type Detail = Row & {
  version: { id: string; code: string; name: string; number: number; rule: string; sampling: string; method: string } | null;
  evaluation: Evaluation | null; rowVersion: number; submittedAt: string | null; startedAt: string | null; assignedAt: string | null; cancelReason: string | null;
  reinspectionReason: string | null; standardDecision: string | null; characteristics: Characteristic[]; samples: Sample[]; observations: Observation[]; superseded: Observation[];
  reviews: Array<{ id: string; action: string; submission: number; proposed: string | null; note: string | null; actor: string | null; at: string }>;
  dispositions: Disposition[]; totals: { accept: number; conditional: number; reject: number; reinspect: number; rework: number; decided: number; undecided: number };
  reinspections: Array<{ id: string; number: string; status: string; quantity: number; standard: string | null; createdAt: string }>;
  nonconformances: Array<{ id: string; number: string; status: string; severity: string; description: string }>; inventory: InventoryStatus | null; productionStatus: ProductionStatus | null;
  dispatchStatus: DispatchStatus | null;
  files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
  history: Array<{ type: string; label: string; at: string; actor: string | null; detail: string | null }>;
  actions: Record<"assign" | "start" | "record" | "submit" | "review" | "decide" | "waive" | "reinspect" | "amend" | "cancel" | "release" | "nonconformance" | "upload" | "confirmRework" | "scrap", boolean>;
};
export type Counts = Record<"awaiting" | "mine" | "in_progress" | "review" | "disposition" | "reinspection" | "completed" | "overdue" | "cancelled" | "exceptions", number>;
export type Dashboard = { counts: Counts; receiptsHeld: number; quantityHeld: number; failed90: number; completed90: number; averageHours: number | null };
export type FinalDashboard = { counts: Counts; lotsOnHold: number; heldQuantity: number; awaitingAcceptance: number; failed90: number; completed90: number; reworkRequired: number;
  averageHours: number | null; lots: Array<{ id: string; number: string; status: string; disposition: string; order: string; lot: string | null; entry: string | null; item: string | null }>;
  blocked: InProcessDashboard["blocked"] };
export type InProcessDashboard = { counts: Counts; blockedOperations: number; wipOnHold: number; failed90: number; completed90: number; reworkRequired: number; averageHours: number | null;
  pendingByOrder: Array<{ id: string; number: string; pending: number }>;
  blocked: Array<{ order: string; orderId: string; label: string; requirement: string; status: string; exception: string | null; scope: string; held: number;
    inspection: { id: string; number: string; status: string } | null; href: string }> };
export type DispatchDashboard = { counts: Counts; deliveriesBlocked: number; heldQuantity: number; rejectedQuantity: number; rejectedNotHeld: number; failed90: number; completed90: number;
  averageHours: number | null; blocked: Array<{ delivery: string; deliveryId: string; label: string; requirement: string; status: string; exception: string | null; held: number;
    inspection: { id: string; number: string; status: string } | null; href: string }> };
export type ExceptionRow = { kind: string; label: string; href: string; at: string };
export type Options = { inspectors: Option[]; receiptLines?: Array<Option & { quantity: number }>; entries?: Array<Option & { quantity: number }>;
  deliveryLines?: Array<Option & { quantity: number }>; canCreate?: boolean; decisions?: Option[];
  priorities: Option[]; reports: Option[] };
export type Report = { kind: string; title: string; rows: Array<Record<string, unknown>> };

// One client per kind of inspection.
export function apiFor(kind: Kind) {
  const k = KIND[kind];
  return {
    kind, base: k.base, key: k.key, title: k.title, noun: k.noun,
    list: (view: string, search: string, from = "", to = "", orderId = "", deliveryId = "") => call<{ rows: Row[] }>(`${k.api}${qs({ view, search, from, to, orderId, deliveryId })}`),
    get: (id: string) => call<Detail>(`${k.api}/${id}`),
    counts: () => call<{ counts: Counts }>(`${k.api}/view/counts`).then((r) => r.counts),
    dashboard: <T = Dashboard>() => call<T>(`${k.api}/view/dashboard`),
    options: () => call<Options>(`${k.api}/view/options`),
    exceptions: () => call<{ rows: ExceptionRow[] }>(`${k.api}/exceptions`).then((r) => r.rows),
    report: (kindOf: string, from = "", to = "") => call<Report>(`${k.reports}${qs({ kind: kindOf, from, to })}`),
    csvHref: (kindOf: string, from = "", to = "") => `/api/quality${k.reports}${qs({ kind: kindOf, from, to, format: "csv" })}`,
    action: <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown> = {}) => call<T>(`${k.api}/${id}/${action}`, { method: "POST", body: JSON.stringify(body) }),
    create: (body: Record<string, unknown>) => call<{ id: string; replayed?: boolean }>(k.api, { method: "POST", body: JSON.stringify(body) }),
    evidenceHref: (id: string, fileId: string) => `/api/quality${k.api}/${id}/files/${fileId}`,
    upload: async (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return call<{ file: { id: string; fileName: string } }>(`${k.api}/${id}/files`, { method: "POST", body: form });
    },
    remove: (id: string, fileId: string) => call<{ removed: boolean }>(`${k.api}/${id}/files/${fileId}`, { method: "DELETE" }),
  };
}
export type InspectionApi = ReturnType<typeof apiFor>;

export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PENDING: "neutral", ASSIGNED: "info", IN_PROGRESS: "info", AWAITING_REVIEW: "warning",
  CHANGES_REQUESTED: "warning", EVALUATED: "info", COMPLETED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const OUTCOME_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PASS: "success", FAIL: "danger", REVIEW_REQUIRED: "warning", NOT_EVALUATED: "neutral",
  REQUIRES_REVIEW: "warning", NOT_APPLICABLE: "neutral", RECORDED: "info" };
export const OUTCOME_LABEL: Record<string, string> = { PASS: "Pass", FAIL: "Fail", REVIEW_REQUIRED: "Needs a reviewer's judgement" };
export const DISPOSITION_LABEL: Record<string, string> = { NONE: "Not decided", PARTIAL: "Partly decided", DECIDED: "Decided" };
export const CHECKPOINT_LABEL: Record<string, string> = { FINAL_OUTPUT: "Finished output", FIRST_PIECE: "First piece", OPERATION_COMPLETION: "Reported output", PERIODIC: "Periodic checkpoint", MANUAL: "Requested by hand",
  REWORK: "After rework" };
export const num = (value: number | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 }));
