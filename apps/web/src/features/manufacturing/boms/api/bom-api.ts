"use client";

// Bill of Materials: the client of /api/manufacturing/{boms, bom-options, bom-snapshots, material-demands}.
import { MfgApiError } from "@/features/manufacturing/shared/client";

export { MfgApiError };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/manufacturing${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new MfgApiError(payload.message || "The request could not be completed.", response.status, payload.code) as MfgApiError & { details?: { issues?: BomIssue[] } };
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
const post = <T>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof MfgApiError ? error.status : 0);
export const errorIssues = (error: unknown): BomIssue[] => ((error as { details?: { issues?: BomIssue[] } })?.details?.issues ?? []);
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export type BomStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "SUPERSEDED" | "OBSOLETE" | "REJECTED";
export type BomIssue = { severity: "error" | "warning"; code: string; message: string; lineNumber?: number };
export type BomListRow = {
  id: string; number: string; name: string | null; finishedItem: { id: string; code: string; name: string }; state: BomStatus | "ARCHIVED"; activeRevision: number | null;
  latestRevision: number | null; latestStatus: BomStatus | null; output: string; lines: number; updatedAt: string;
};
export type BomLine = {
  id?: string; lineageId?: string; lineNumber: number; componentItemId: string; code: string; name: string; quantity: string; uomId: string; uom: string; consumptionMode: "PROPORTIONAL" | "FIXED_PER_BATCH";
  scrapAllowancePct: string; childBomRevisionId: string | null; childBom: string | null; childNewer?: string | null; kind: "material" | "subassembly"; trackingType: string; notes: string | null;
};
export type RevisionChange = { type: "LINE_ADDED" | "LINE_REMOVED" | "LINE_MODIFIED" | "HEADER_MODIFIED" | "CHILD_PINNED"; lineageId: string | null; item: string | null;
  from: Record<string, unknown> | null; to: Record<string, unknown> | null; reason: string | null; at: string; actor: string | null };
export type Effectivity = { id: string; revisionId: string; revisionNumber: number; status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED"; effectiveFrom: string; effectiveTo: string | null;
  scheduledBy: string | null; scheduledAt: string; cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null };
export type BomRevision = {
  id: string; revisionNumber: number; status: BomStatus; statusLabel: string; version: number; outputQuantity: string; outputUomId: string; outputUom: string; expectedYieldPct: string;
  batchSize: string | null; description: string | null; defaultWarehouseId: string | null; defaultWarehouse: string | null; effectiveFrom: string | null; effectiveTo: string | null; scheduled: boolean; approvedContentHash: string | null; basedOnRevisionId: string | null;
  basedOnRevisionNumber: number | null; changeReason: string | null; contentHash: string | null; createdBy: string | null; createdAt: string; submittedBy: string | null; submittedAt: string | null; approvedBy: string | null;
  approvedAt: string | null; approvalNote: string | null; rejectedBy: string | null; rejectedAt: string | null; rejectionReason: string | null; activatedBy: string | null; activatedAt: string | null;
  obsoleteReason: string | null; lines: BomLine[]; changes: RevisionChange[]; validation: { valid: boolean; issues: BomIssue[] } | null;
};
export type Bom = {
  id: string; number: string; name: string | null; archivedAt: string | null; archiveReason: string | null; finishedItem: { id: string; code: string; name: string; baseUomId: string; trackingType: string };
  createdBy: string | null; createdAt: string; effectiveRevisionId: string | null;
  revisions: Array<{ id: string; revisionNumber: number; status: BomStatus; statusLabel: string; scheduled: boolean; effectiveFrom: string | null; effectiveTo: string | null; changeReason: string | null;
    approvedBy: string | null; approvedAt: string | null; basedOnRevisionId: string | null; updatedAt: string }>;
  effectivities: Effectivity[];
  revision: BomRevision | null;
  whereUsed: { parents: Array<{ bomId: string; bomNumber: string; product: string; revisionNumber: number; status: BomStatus }>; productionSnapshots: number; openDemands: number };
  history: Array<{ action: string; fromStatus: string | null; toStatus: string | null; reason: string | null; details: Record<string, unknown>; at: string; actor: string | null; revisionNumber: number | null }>;
  can: Record<"edit" | "submit" | "withdraw" | "approve" | "activate" | "cancelSchedule" | "obsolete" | "revise" | "discard" | "archive" | "duplicate" | "viewCost" | "export" | "useForProduction", boolean>;
};
export type BomOptions = {
  products: Array<{ id: string; code: string; name: string; uomId: string; uom: string; hasBom: boolean }>;
  materials: Array<{ id: string; code: string; name: string; uomId: string; uom: string; trackingType: string; hasBom: boolean }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
};
export type ItemUnits = { units: Array<{ uomId: string; code: string; factor: string; decimals: number; isBase: boolean; text: string }>; recipes: Array<{ id: string; label: string }> };
export type ExplosionLine = {
  level: number; path: string; lineNumber: number; parentCode: string; itemId: string; code: string; name: string; baseUom: string; quantity: string; uom: string; mode: string;
  scrapAllowancePct: string; beforeAllowance: string; required: string; kind: "material" | "subassembly"; fromStock?: string; toMake?: string; decision?: string; childBom?: string;
};
export type Preview = {
  revisionNumber: number; finishedItem: { id: string; code: string; name: string }; plannedQuantity: string; plannedUom: string; nominalQuantity: string; batches: number; expectedYieldPct: string;
  policy: string; lines: ExplosionLine[]; manufactured: Array<{ itemId: string; code: string; name: string; quantity: string; baseUom: string; revision: string; level: number }>;
  consumed: Array<{ itemId: string; code: string; name: string; baseUom: string; kind: string; required: string }>; assumptions: string[]; issues: BomIssue[];
  availability: { checkedAt: string; warehouseId: string | null; hasShortages: boolean; unknown: boolean;
    lines: Array<{ itemId: string; code: string; name: string; baseUom: string; kind: string; required: string; available: string | null; shortage: string | null; status: "available" | "short" | "unknown" }> };
  cost: CostEstimate | null; previewOnly: true;
};
export type CostEstimate = {
  calculatedAt: string; currency: string; totalMaterialCost: string; perUnit: string | null; complete: boolean; missing: string[]; stale: string[]; warnings: string[]; note: string;
  lines: Array<{ itemId: string; code: string; name: string; required: string; baseUom: string; unitCost: string | null; amount: string | null; basis: string | null; stale: boolean; missing: boolean }>;
};
export type PlanInput = { plannedQuantity: string; uomId?: string; warehouseId?: string | null; policy?: string; choices?: Record<string, "MAKE" | "USE_STOCK" | { useFromStock: string }> };
export type LineView = { lineNumber: number; quantity: string; uom: string; baseQuantity: string | null; mode: string; scrapAllowancePct: string; childRevision: string | null; notes: string | null };
export type Comparison = {
  bomId: string; bomNumber: string;
  from: { id: string; revisionNumber: number; status: BomStatus; effectiveFrom: string | null; changeReason: string | null };
  to: { id: string; revisionNumber: number; status: BomStatus; effectiveFrom: string | null; changeReason: string | null };
  header: Array<{ field: string; from: string | null; to: string | null }>;
  lines: Array<{ itemId: string; code: string; name: string; lineageId: string; matchedBy: "lineage" | "material" | null; change: "added" | "removed" | "changed" | "unchanged"; fields: string[];
    childRevisionChanged: boolean; from: LineView | null; to: LineView | null }>;
  summary: { added: number; removed: number; changed: number; unchanged: number };
  requirements?: RequirementsComparison;
};
export type RequirementsComparison = {
  plannedQuantity: string; plannedUom: string; policy: string;
  from: { revisionNumber: number; nominalQuantity: string; batches: number; assumptions: string[] }; to: { revisionNumber: number; nominalQuantity: string; batches: number; assumptions: string[] };
  materials: Array<{ itemId: string; code: string; name: string; baseUom: string; kind: string; from: string; to: string; difference: string; change: "added" | "removed" | "changed" | "unchanged" }>;
  availability: Preview["availability"];
  cost: null | { basis: { calculatedAt: string; warehouseId: string | null; note: string }; from: { total: string; complete: boolean }; to: { total: string; complete: boolean }; difference: string;
    complete: boolean; missing: string[]; warnings: string[];
    lines: Array<{ itemId: string; code: string; unitCost: string | null; basis: string | null; costAsOf: string | null; stale: boolean; from: string | null; to: string | null; difference: string | null }> };
  error?: string;
};
export type Impact = {
  bomId: string; bomNumber: string; finishedItem: { id: string; code: string; name: string };
  revision: { id: string; revisionNumber: number; status: BomStatus; effectiveFrom: string | null; effectiveTo: string | null; changeReason: string | null };
  current: { id: string; revisionNumber: number; effectiveFrom: string; effectiveTo: string | null } | null;
  scheduled: Array<{ revisionId: string; revisionNumber: number; effectiveFrom: string; effectiveTo: string | null }>;
  comparison: Comparison | null; requirements: RequirementsComparison | null; samplePlannedQuantity: string;
  parents: Array<{ bomId: string; bomNumber: string; product: string; revisionNumber: number; status: BomStatus; pinnedRevision: number | null; pinsThisRevision: boolean; effect: string }>;
  children: Array<{ itemId: string; code: string; name: string; pinned: string; pinnedStatus: string; effectiveNow: string | null; newerAvailable: boolean }>;
  production: { frozenRecipes: Array<{ revisionNumber: number; count: number; latest: string; references: string[] }>; orders: { mayNeedReview: number; unchanged: number };
    openDemands: number; note: string };
};
export type PendingApproval = { revisionId: string; bomId: string; bomNumber: string; product: string; revisionNumber: number; basedOn: number | null; changeReason: string | null; lines: number;
  submittedBy: string | null; submittedAt: string | null; contentHash: string | null; selfSubmitted: boolean; canApprove: boolean };
export type MaterialDemand = { id: string; number: string; item: string; quantity: string; uom: string; warehouse: string | null; requiredBy: string | null; status: string; source: string | null;
  bomId: string | null; createdBy: string | null; createdAt: string; closeNote: string | null };

export const listBoms = (filters: Record<string, string | undefined>) => call<{ boms: BomListRow[] }>(`/boms${qs(filters)}`).then((r) => r.boms);
export const getBom = (id: string, revisionId?: string | null) => call<{ bom: Bom }>(`/boms/${id}${qs({ revisionId })}`).then((r) => r.bom);
export const createBom = (input: Record<string, unknown>) => post<{ bom: Bom }>(`/boms`, input).then((r) => r.bom);
export const saveDraft = (bomId: string, revisionId: string, input: Record<string, unknown>) => post<{ bom: Bom }>(`/boms/${bomId}/revisions/${revisionId}`, input, "PATCH").then((r) => r.bom);
export const newRevision = (bomId: string, changeReason: string, basedOnRevisionId?: string, idempotencyKey?: string) =>
  post<{ bom: Bom }>(`/boms/${bomId}/revisions`, { changeReason, basedOnRevisionId, idempotencyKey }).then((r) => r.bom);
export const archiveBom = (bomId: string, reason: string) => post<{ bom: Bom }>(`/boms/${bomId}/archive`, { reason }).then((r) => r.bom);
export const revisionAction = <T = { bom: Bom }>(bomId: string, revisionId: string, action: string, input: Record<string, unknown> = {}) =>
  post<T>(`/boms/${bomId}/revisions/${revisionId}/${action}`, input);
export const compare = (bomId: string, from: string, to: string, plan: { plannedQuantity?: string; uomId?: string | null; warehouseId?: string | null; policy?: string } = {}) =>
  call<{ comparison: Comparison }>(`/boms/${bomId}/compare${qs({ from, to, ...plan })}`).then((r) => r.comparison);
export const impactOf = (bomId: string, revisionId: string, plan: { plannedQuantity?: string; warehouseId?: string | null } = {}) =>
  call<{ impact: Impact }>(`/boms/${bomId}/revisions/${revisionId}/impact${qs(plan)}`).then((r) => r.impact);
export const pendingApprovals = () => call<{ approvals: PendingApproval[] }>(`/bom-approvals`).then((r) => r.approvals);
export const bomOptions = () => call<{ options: BomOptions }>(`/bom-options`).then((r) => r.options);
export const itemUnits = (itemId: string) => call<{ units: ItemUnits }>(`/bom-options/units${qs({ itemId })}`).then((r) => r.units);
export const freezeForProduction = (input: Record<string, unknown>) => post<{ snapshot: { id: string; plannedQuantity: string; replayed: boolean } }>(`/bom-snapshots`, input).then((r) => r.snapshot);
export const listDemands = (status?: string) => call<{ demands: MaterialDemand[] }>(`/material-demands${qs({ status })}`).then((r) => r.demands);
export const updateDemand = (id: string, action: "acknowledge" | "fulfil" | "cancel", note?: string) => post<{ demand: MaterialDemand }>(`/material-demands/${id}`, { action, note }).then((r) => r.demand);

export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", PENDING_APPROVAL: "warning", APPROVED: "info", ACTIVE: "success", SUPERSEDED: "neutral", OBSOLETE: "neutral", REJECTED: "danger", ARCHIVED: "neutral",
};
export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", APPROVED: "Approved", ACTIVE: "Active", SUPERSEDED: "Superseded", OBSOLETE: "Obsolete", REJECTED: "Rejected", ARCHIVED: "Archived",
};
export const qty = (value: string | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 }));
export const inr = (value: string | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-IN", { style: "currency", currency: "INR" }));
