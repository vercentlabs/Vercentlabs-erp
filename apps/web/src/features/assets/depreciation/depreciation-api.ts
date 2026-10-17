"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/depreciation: policies, each asset's basis and schedule, monthly runs, estimate changes, exceptions,
// reconciliation with the General Ledger and reports. Amounts arrive as decimal strings (null without the financial-figures permission).
export const DEPRECIATION_BASE = "/assets/depreciation";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/depreciation${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type DepreciableAsset = { assetId: string; asset: string; category: string | null; department: string | null; lifecycle: string; state: string; label: string; policy: string | null; basisVersion: number | null;
  source: string | null; convention: string | null; usefulLifeMonths: number | null; remainingLifeMonths: number | null; commencement: string | null; cost: string | null; residual: string | null; monthly: string | null;
  accumulated: string | null; carrying: string | null; nextPeriod: string | null; lastPosted: string | null; href: string };
export type ScheduleLine = { period: string; opening: string | null; amount: string | null; accumulated: string | null; closing: string | null; posted: string | null; variance: string | null;
  actualAccumulated: string | null; actualClosing: string | null; days: string | null; rounding: string | null; status: string; statusLabel: string; note: string | null;
  run: string | null; runId: string | null; journalEntryId: string | null; journalNumber: string | null; journalHref: string | null; financialYear: string };
export type ScheduleVersion = { id: string; version: number; lifecycle: string; lifecycleLabel: string; inForce: boolean; basisId: string; firstPeriod: string | null; lastPeriod: string | null;
  effectiveFrom: string | null; total: string | null; monthly: string | null; algorithm: string; approvedBy: string | null; approvedAt: string | null; generatedAt: string; closedReason: string | null;
  supersedes: string | null; validationErrors: Array<{ code: string; message: string }>; rowVersion: number; canApprove: boolean };
export type ScheduleRow = { scheduleId: string; assetId: string; asset: string; category: string | null; version: number; lifecycle: string; lifecycleLabel: string; policy: string; method: string; book: string;
  effectiveFrom: string | null; lastPeriod: string | null; cost: string | null; residual: string | null; remainingLifeMonths: number | null; monthly: string | null; planned: string | null; posted: string | null;
  variance: string | null; nextPeriod: string | null; dueUnposted: number; attention: string | null; approvedBy: string | null; approvedAt: string | null; closedReason: string | null; href: string };
export type SchedulePreview = { valid: boolean; errors: Array<{ code: string; message: string }>; commencement?: string; usefulLifeMonths?: number; residual?: string; convention?: string; monthly?: string; total?: string;
  lines: Array<{ periodStart: string; amount: string; closing: string; eligibleDays: number; periodDays: number }> };
export type BasisVersion = { id: string; version: number; source: string; status: string; cost: string | null; carrying: string | null; residual: string | null; remainingLifeMonths: number; commencement: string;
  effectiveFrom: string; convention: string; reason: string | null; requestedBy: string | null; approvedBy: string | null; approvedAt: string | null; decisionNote: string | null; canDecide: boolean };
export type AssetDepreciation = DepreciableAsset & { book: string; method: string; postingStatus: string; schedule: ScheduleLine[]; version: ScheduleVersion | null; versions: ScheduleVersion[];
  opening: { label: string; source: string; accumulated: string | null; carrying: string | null; cost: string | null } | null;
  totals: { planned: string | null; posted: string | null; variance: string | null; exceptions: number; due: number }; years: Array<{ year: string; months: number; amount: string | null; posted: string | null }>;
  bases: BasisVersion[]; events: Array<{ action: string; details: Record<string, unknown>; reason: string | null; at: string; by: string | null }>; note: string;
  can: { propose: boolean; revise: boolean; generate: boolean; financials: boolean } };
export type Overview = { depreciating: number; notStarted: number; fullyDepreciated: number; stale: number; dueThisMonth: string | null; dueLines: number; openRuns: Record<string, number>; proposals: number;
  can: { prepare: boolean; policy: boolean; generate: boolean; reconcile: boolean; export: boolean; financials: boolean } };
export type Policy = { id: string; code: string; version: number; name: string; book: string; method: string; usefulLifeMonths: number; residual: string; convention: string; commencement: string;
  expenseAccount: string | null; accumulatedAccount: string | null; category: string | null; effectiveFrom: string; status: string; approvedBy: string | null; reason: string | null };
export type Run = { id: string; number: string; period: string; periodStart: string; periodEnd: string; book: string; status: string; statusLabel: string; proposedTotal: string | null; approvedTotal: string | null;
  postedTotal: string | null; summary: { assetsWithCharge?: number; lines?: number; excluded?: Record<string, number>; trackedOnly?: number; blocking?: boolean; fullyDepreciated?: number; proposedTotal?: string; alreadyPosted?: string; eligible?: number };
  journalEntryId: string | null; preparedBy: string | null; preparedAt: string; approvedBy: string | null; approvedAt: string | null; postedBy: string | null; postedAt: string | null; cancelReason: string | null; version: number; href: string };
export type RunLine = { id: string; assetId: string; asset: string; category: string | null; department: string | null; period: string | null; scheduled: string | null; amount: string | null; status: string;
  code: string | null; reason: string | null; blocking: boolean; expenseAccount: string | null; accumulatedAccount: string | null; href: string };
export type RunDetail = Run & { included: RunLine[]; excluded: RunLine[]; byCategory: Array<{ name: string; total: string | null }>; byAccount: Array<{ name: string; total: string | null }>;
  byDepartment: Array<{ name: string; total: string | null }>; exclusionLabels: Record<string, string>; catchUpMonths: string[]; catchUpAcknowledged: boolean; preparedByAutomation: boolean;
  automationExecutionId: string | null; can: { recalculate: boolean; approve: boolean; post: boolean; recover: boolean; cancel: boolean } };
export type EstimateChange = { id: string; assetId: string; asset: string; source: string; status: string; effectiveFrom: string; remainingLifeMonths: number; previousRemaining: number | null; residual: string | null;
  previousResidual: string | null; reason: string | null; requestedBy: string | null; approvedBy: string | null; decisionNote: string | null; canDecide: boolean; href: string };
export type Reconciliation = { matched: boolean; runs: Array<{ runId: string; run: string; period: string; scheduleTotal: string; glTotal: string; glStatus: string | null; matched: boolean }>;
  assetDifferences: Array<{ assetId: string; asset: string; register: string; expected: string }>; byAccount: Array<{ expense: string | null; accumulated: string | null; total: string }>; message: string | null };
export type RevisionPreview = { effectiveFrom: string; carrying: string; residual: string; remainingLifeMonths: number; monthly: string; old: Array<{ period: string; amount: string; closing: string }>; next: Array<{ period: string; amount: string; closing: string }> };

const get = <T,>(action: string, params: Record<string, string | undefined> = {}) => call<T>(`/actions/${action}${qs(params)}`);
export const getOverview = () => get<Overview>("overview");
export const getDepreciableAssets = (view: string, search = "") => get<{ rows: DepreciableAsset[] }>("assets", { view, search }).then((r) => r.rows);
export const getPolicies = (all = false) => get<{ rows: Policy[]; can: { manage: boolean } }>("policies", { all: all ? "true" : undefined });
export const getRuns = (view: string) => get<{ rows: Run[]; can: { prepare: boolean } }>("runs", { view });
export const getEstimateChanges = () => get<{ rows: EstimateChange[] }>("estimate-changes").then((r) => r.rows);
export const getExceptions = () => get<{ rows: Array<{ kind: string; label: string; subject: string; href: string }> }>("exceptions").then((r) => r.rows);
export const getReconciliation = () => get<Reconciliation>("reconciliation");
export const getReport = (kind: string) => get<{ rows: Array<Record<string, unknown>> }>("report", { kind }).then((r) => r.rows);
export const getRun = (id: string) => call<RunDetail>(`/runs/${id}`);
export const getAssetDepreciation = (assetId: string, versionId?: string) => call<AssetDepreciation>(`/assets/${assetId}${qs({ versionId })}`);
export const getSchedules = (view: string, search = "", postingState?: string) => get<{ rows: ScheduleRow[] }>("schedules", { view, search, postingState }).then((r) => r.rows);
export const getDueLines = (period: string) => get<{ period: string; total: string | null; assets: number; rows: Array<{ asset: string; assetId: string; month: string; amount: string | null; scheduleVersion: number; inRun: string | null; catchUp: boolean; href: string }> }>("due", { period });
export const approveSchedule = (scheduleId: string, expectedVersion: number, note?: string) => send<{ status: string; code?: string; message?: string }>(`/schedules/${scheduleId}/approve`, { expectedVersion, note });
export const previewSchedule = (assetId: string, input: Record<string, unknown> = {}) => send<SchedulePreview>(`/assets/${assetId}/preview-schedule`, input);
export const previewRevision = (assetId: string, input: Record<string, unknown>) => send<RevisionPreview>(`/assets/${assetId}/preview-revision`, input);
export const assetAction = (assetId: string, action: string, input: Record<string, unknown> = {}) => send(`/assets/${assetId}/${action}`, input);
export const runAction = <T = Record<string, unknown>>(runId: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/runs/${runId}/${action}`, input);
export const depreciationAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown> = {}) => send<T>(`/actions/${action}`, input);
export const depreciationExportHref = (kind: "schedule" | "register", assetId?: string) => `/api/assets/depreciation/export${qs({ kind, assetId })}`;

export const RUN_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", CALCULATING: "info", READY_FOR_REVIEW: "info", NEEDS_CORRECTION: "danger", APPROVED: "info",
  POSTING: "warning", POSTED: "success", PARTIALLY_POSTED: "warning", RECOVERY_REQUIRED: "danger", CANCELLED: "neutral" };
export const STATE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DEPRECIATING: "success", FULLY_DEPRECIATED: "neutral", NO_BASIS: "warning", NOT_COMMENCED: "info",
  NOT_CAPITALIZED: "neutral", STALE: "danger", DISPOSED: "neutral", TRACKED_ONLY: "neutral" };
export const LINE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PLANNED: "neutral", DUE: "warning", IN_POSTING: "info", POSTED: "success", ADJUSTED: "info", SKIPPED: "neutral", EXCEPTION: "danger" };
export const LIFECYCLE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "warning", VALIDATION_FAILED: "danger", CURRENT: "success", SUPERSEDED: "neutral", COMPLETED: "info", TERMINATED: "neutral" };
export const REPORT_KINDS = [
  { id: "asset-schedule", label: "Asset-wise depreciation schedule" }, { id: "monthly", label: "Monthly depreciation" }, { id: "yearly", label: "Yearly depreciation (financial year)" },
  { id: "by-category", label: "Depreciation by category" }, { id: "by-department", label: "Depreciation by department" }, { id: "accumulated", label: "Accumulated depreciation" },
  { id: "nbv-register", label: "Net book value register" }, { id: "fully-depreciated-active", label: "Fully depreciated active assets" }, { id: "not-depreciating", label: "Assets not yet depreciating" },
  { id: "opening", label: "Opening asset depreciation" }, { id: "estimate-changes", label: "Depreciation estimate changes" }, { id: "posting-history", label: "Depreciation posting history" },
  { id: "exceptions", label: "Depreciation exceptions" }, { id: "reconciliation", label: "Schedule-to-GL reconciliation" },
  { id: "planned-vs-posted", label: "Planned versus posted" }, { id: "monthly-planned", label: "Monthly planned depreciation (projected)" }, { id: "annual-forecast", label: "Annual depreciation forecast (projected)" },
  { id: "posted-by-period", label: "Posted depreciation by period" }, { id: "schedule-revisions", label: "Schedule revision history" }, { id: "disposal-closures", label: "Disposal-related schedule closures" },
];
