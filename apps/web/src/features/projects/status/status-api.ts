"use client";

// Projects — Project Status: the client of the lifecycle — the status actions a person may take, the hold and its blockers, the readiness
// checks before resuming or completing, the reviews before cancelling or reopening, the timeline and the status reports. Every change goes
// through the server's one state machine; a request whose answer was lost is checked (by its key), never sent again blindly.
import { ProjectApiError, call, newKey, projectAction, qs, send, type ProjectStatus } from "../api/projects-api";

export type StatusActionKey = "activate" | "start" | "hold" | "resume" | "complete" | "reopen" | "cancel";
export type StatusAction = { action: StatusActionKey; label: string; allowed: boolean; reason: string | null };
export type Check = { key: string; label: string; state: "PASS" | "FAIL" | "WARN" | "NOT_TRACKED" | "TO_CONFIRM"; message: string; blocking: boolean; code?: string };
export type HoldReason = {
  id: string; reasonCode: string; reasonLabel: string; description: string; severity: string; severityLabel: string; ownerUserId: string | null; owner: string | null;
  source: { type: "TASK" | "MILESTONE"; id: string; label: string | null } | null; evidence: string | null; addedAt: string; addedBy: string | null;
  resolved: boolean; resolvedAt: string | null; resolvedBy: string | null; resolution: string | null; resolutionEvidence: string | null;
};
export type Hold = { id: string; previousStatus: ProjectStatus; previousStatusLabel: string; startedAt: string; startedBy: string | null; owner: string | null; expectedResolutionDate: string | null;
  summary: string; reasons: HoldReason[]; open: number };
export type ResumeReadiness = { ready: boolean; resumesTo: ProjectStatus | null; resumesToLabel: string | null; checks: Check[]; hold: Hold | null };
export type CompletionReadiness = { ready: boolean; checks: Check[]; completionDate: string; openTasks: Array<{ id: string; code: string; title: string; priority: string; waivable: boolean }> };
export type CancellationReview = { dependencies: Array<{ type: string; number: string | null; status: string | null; message: string }>; members: number; hold: string | null; notes: string[];
  openTasks: number; openMilestones: number; assignedPeople: number; reasons: Array<{ code: string; label: string }> };
export type ReopenReview = { acceptedMilestones: string[]; doneTasks: number; billing: string[]; reopenCount: number; completedOn: string | null; previousCompletions: string[];
  reasons: Array<{ code: string; label: string }>; needsAcknowledgement: boolean; notes: string[] };
export type StatusHistory = {
  transitions: Array<{ action: string; from: string | null; fromLabel: string | null; to: string; toLabel: string; reasonCode: string | null; reason: string | null; actor: string; at: string; version: number | null }>;
  completions: Array<{ completionDate: string; signedOffBy: string | null; signedOffAt: string; closingNote: string; customerAcceptance: string | null;
    waivers: Array<{ code: string; title: string; reason: string; impact: string | null }>; outstanding: Array<{ key: string; label: string; message: string }> }>;
};

export const HOLD_REASON_LABEL: Record<string, string> = {
  CUSTOMER_APPROVAL_PENDING: "Customer approval pending", RESOURCE_UNAVAILABLE: "Resource unavailable", REQUIREMENTS_CHANGE: "Requirements change",
  DEPENDENCY_BLOCKED: "Dependency blocked", TECHNICAL_ISSUE: "Technical issue", BUDGET_REVIEW: "Budget review", COMPLIANCE_OR_SAFETY: "Compliance or safety",
  MANAGEMENT_DECISION: "Management decision", OTHER: "Other",
};
export const SEVERITY_LABEL: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export const getHold = (id: string) => call<{ hold: Hold | null }>(`/${id}/hold`).then((r) => r.hold);
export const getResumeReadiness = (id: string) => call<{ readiness: ResumeReadiness }>(`/${id}/resume-readiness`).then((r) => r.readiness);
export const getCompletionReadiness = (id: string) => call<{ readiness: CompletionReadiness }>(`/${id}/completion-readiness`).then((r) => r.readiness);
export const getCancellationReview = (id: string) => call<{ review: CancellationReview }>(`/${id}/cancellation-review`).then((r) => r.review);
export const getReopenReview = (id: string) => call<{ review: ReopenReview }>(`/${id}/reopen-review`).then((r) => r.review);
export const getStatusHistory = (id: string) => call<{ history: StatusHistory }>(`/${id}/status-history`).then((r) => r.history);
export const getStatusReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/status${qs({ kind })}`).then((r) => r.rows);
export const addHoldReason = (id: string, input: Record<string, unknown>) => send<{ reasonId: string }>(`/${id}/hold/reasons`, { idempotencyKey: newKey(), ...input });
export const resolveHoldReason = (id: string, reasonId: string, input: { resolution: string; evidence?: string }) => send<{ openReasons: number }>(`/${id}/hold/reasons/${reasonId}/resolve`, input);

// A status command. If the answer is lost (the network, not a refusal), the server is asked whether the command with this key was applied —
// the person is never told it worked until the server says so, and never asked to send it again blindly.
export async function runStatusAction(id: string, action: StatusActionKey | "decide", input: Record<string, unknown>, key: string) {
  try {
    return await projectAction(id, action, { ...input, idempotencyKey: key });
  } catch (failure) {
    if (failure instanceof ProjectApiError && failure.status > 0) throw failure;
    const outcome = await call<{ outcome: { applied: boolean; status: string } }>(`/${id}/transition-outcome${qs({ key })}`).then((r) => r.outcome).catch(() => null);
    if (outcome?.applied) return { projectId: id, status: outcome.status, recovered: true };
    throw new ProjectApiError(outcome ? "The change was not applied. Check the details and try again." : "Checking the previous request. Do not submit again.", 0, "PROJECT_STATUS_OPERATION_UNKNOWN");
  }
}
