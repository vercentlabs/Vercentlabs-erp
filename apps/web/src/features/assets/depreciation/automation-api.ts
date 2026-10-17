"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/depreciation/automation: the automation policy (manual, prepare + approve, automatic posting), its
// health, executions and audit, a run's journal preview, and the automation reports. Posting itself stays the depreciation run's.
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/depreciation/automation${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type AutomationPolicy = { id: string; version: number; mode: string; modeLabel: string; triggerDaysAfterPeriodEnd: number; closeDeadlineDays: number; firstPeriod: string; notifyFinance: boolean;
  postingUser: string | null; enabledBy: string | null; enabledAt: string | null; reason: string | null; savedBy: string | null; savedAt: string; status: string };
export type Execution = { id: string; period: string; mode: string; modeLabel: string; trigger: string; status: string; statusLabel: string; reconciliation: string | null; reconciliationLabel: string | null;
  attempts: number; errorCode: string | null; error: string | null; runId: string | null; run: string | null; runStatus: string | null; proposedTotal: string | null; postedTotal: string | null;
  journalEntryId: string | null; journalNumber: string | null; journalHref: string | null; policyVersion: number | null; triggeredBy: string | null; startedAt: string; completedAt: string | null; href: string | null };
export type Automation = { policy: AutomationPolicy | null; configured: boolean; effectiveMode: string; effectiveModeLabel: string; book: string; nextEligibleMonth: string | null; health: string; healthLabel: string;
  counts: { awaitingApproval: number; exceptions: number; failed: number; verifying: number; mismatches: number; overdueMonths: number };
  overdue: Array<{ month: string; assets: number; amount: string | null }>; executions: Execution[];
  upcoming: Array<{ month: string; eligibleOn: string; expected: string | null; assets: number; run: string | null; runStatus: string | null; href: string | null }>;
  readiness: { ready: boolean; issues: Array<{ code: string; message: string; count: number | null }> }; note: string; can: { configure: boolean; enable: boolean; retry: boolean; run: boolean } };
export type JournalPreview = { runId: string; run: string; period: string; journalDate: string; status: string; book: string; journal: { id: string; number: string | null; status: string | null; href: string | null } | null;
  lines: Array<{ account: string | null; debit: string | null; credit: string | null; assets: number }>; groups: Array<{ expenseAccount: string | null; accumulatedAccount: string | null; total: string | null;
    departments: Array<{ name: string; total: string | null }>; allocations: Array<{ assetId: string; asset: string; month: string; amount: string | null; status: string; catchUp: boolean }> }>;
  totalDebit: string | null; totalCredit: string | null; balanced: boolean; mapped: boolean; catchUpMonths: string[]; reconciliation: string | null };

export const getAutomation = () => call<Automation>("");
export const getExecutions = (view: string) => call<{ rows: Execution[] }>(`/executions${qs({ view })}`).then((r) => r.rows);
export const getAutomationAudit = () => call<{ versions: AutomationPolicy[]; attempts: Array<{ month: string; trigger: string; attempt: number; outcome: string; details: Record<string, unknown>; at: string }> }>("/audit");
export const getAutomationReport = (kind: string) => call<{ rows: Array<Record<string, unknown>> }>(`/report${qs({ kind })}`).then((r) => r.rows);
export const getJournalPreview = (runId: string) => call<JournalPreview>(`/journal-preview${qs({ runId })}`);
export const automationAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown> = {}) => send<T>(`/${action}`, input);
export const EXECUTION_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { CLAIMED: "info", WAITING: "neutral", AWAITING_APPROVAL: "warning", POSTING: "warning", POSTED: "success",
  EXCEPTION: "danger", FAILED: "danger", SKIPPED: "neutral" };
export const HEALTH_TONE: Record<string, "success" | "warning" | "danger"> = { HEALTHY: "success", WARNING: "warning", ATTENTION: "danger" };
export const AUTOMATION_REPORT_KINDS = [{ id: "run-history", label: "Automatic depreciation run history" }, { id: "posted-journals", label: "Posted depreciation journals" },
  { id: "by-gl-account", label: "Depreciation by GL account" }, { id: "missing-postings", label: "Missing depreciation postings" }, { id: "failed-partial", label: "Failed / partial automation runs" },
  { id: "policy-changes", label: "Policy and automation changes" }, { id: "opening-first-period", label: "Opening asset first-period reconciliation" }];
