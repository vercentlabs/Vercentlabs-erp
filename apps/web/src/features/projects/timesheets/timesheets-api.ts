"use client";

// Projects — Timesheets: the client of the time entries, the weekly timesheets and their review, corrections, labor rates, the billing
// handoff, reports and settings. Every command carries its key; a lost answer is checked by that key, never sent again blindly.
import { ProjectApiError, call, qs, send } from "../api/projects-api";

export type EntryStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED" | "VOIDED";
export type SubmissionStatus = "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED";
export type Flag = { code: string; label: string };
export type TimeEntry = {
  id: string; number: string; employeeUserId: string; employee: string | null; enteredBy: string | null; projectId: string; project: string; projectCode: string; taskId: string | null; task: string | null;
  workDate: string; weekday: string; startTime: string | null; endTime: string | null; durationMinutes: number; duration: string; description: string; billable: boolean;
  status: EntryStatus; statusLabel: string; submissionId: string | null; flags: Flag[];
  classification: "NON_BILLABLE" | "INCLUDED_IN_FIXED_FEE" | "TIME_AND_MATERIALS_ELIGIBLE" | "ELIGIBILITY_PENDING"; classificationLabel: string; reasonCode: string | null; reason: string | null;
  reasonNote: string | null; contractLineId: string | null; contractLine: string | null; version: number; correctsEntryId: string | null; voidReason: string | null;
  approvedBy: string | null; approvedAt: string | null; createdAt: string; updatedAt: string;
  cost?: { rate: string | null; amount: string | null; currency: string | null; recorded: boolean };
  billing: { state: string; label: string; requestedMinutes?: number; invoicedMinutes?: number };
  can: { edit: boolean; remove: boolean; correct: boolean };
};
export type Totals = { totalMinutes: number; billableMinutes: number; nonBillableMinutes: number; byStatus: Record<string, number>; unsubmittedMinutes: number; total: string; billable: string; nonBillable: string; entries: number };
export type Submission = {
  id: string; number: string; employeeUserId: string; employee: string | null; projectId: string; project: string | null; weekStart: string; weekEnd: string; version: number;
  status: SubmissionStatus; statusLabel: string; approver: string | null; totalMinutes: number; total: string; billableMinutes: number; entries: number; late: boolean; lateReason: string | null;
  flags: Flag[]; submittedAt: string; decidedBy: string | null; decidedAt: string | null; comment: string | null; returnedEntryIds: string[]; rowVersion: number; waitingDays?: number;
};
export type Week = {
  weekStart: string; weekEnd: string; previousWeek: string; nextWeek: string; today: string; deadline: string; late: boolean; employee: { userId: string; name: string | null; me: boolean };
  days: Array<{ date: string; weekday: string; minutes: number; total: string; billableMinutes: number; entries: number; overReview: boolean; today: boolean; future: boolean }>;
  entries: TimeEntry[]; totals: Totals; projects: Array<Totals & { projectId: string; project: string; submission: Submission | null }>; submissions: Submission[];
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "MIXED" | "EMPTY"; summary: string;
  policy: { weekStart: number; dailyReviewMinutes: number; dailyLimitMinutes: number; incrementMinutes: number; deadlineDays: number; lateAllowed: boolean; boundaryDayPolicy: string };
  can: { record: boolean; submit: boolean; export: boolean };
};
export type TimeProject = { id: string; code: string; name: string | null; label: string; status: string; billingMethod: string | null; billingMethodLabel: string; billableAllowed: boolean;
  defaultBillable: boolean; billableNote: string | null; contractLines: Array<{ id: string; label: string }>; teamLead: boolean };
export type TimeOptions = { projects: TimeProject[]; today: string; incrementMinutes: number; dailyLimitMinutes: number; reasonRequired: boolean; reasons: Array<{ code: string; label: string }>;
  can: { record: boolean } };
export type TimeTasks = { tasks: Array<{ id: string; code: string; title: string; label: string; status: string; assignee: string | null; mine: boolean }>; team: Array<{ userId: string; name: string | null }> };
export type Warning = { code: string; message: string };
export type SubmissionDetail = Submission & {
  entries: Array<TimeEntry & { submitted: Record<string, unknown>; submittedVersion: number; changedSinceSubmitted: boolean; returned: boolean }>; totals: Totals;
  checks: Array<{ key: string; label: string; state: "PASS" | "FAIL" | "WARN"; message?: string | null }>; versions: Submission[];
  history: Array<{ id: string; action: string; summary: string | null; actor: string; at: string }>; can: { approve: boolean; requestChanges: boolean; mine: boolean };
};
export type TeamRow = { projectId: string; project: string; employeeUserId: string; employee: string | null; recordedMinutes: number; recorded: string | null; unsubmittedMinutes: number;
  submittedMinutes: number; approvedMinutes: number; state: "NO_TIME" | "LATE" | "PENDING_SUBMISSION" | "AWAITING_REVIEW" | "APPROVED"; summary: string; submission: Submission | null };
export type TeamWeek = { weekStart: string; weekEnd: string; previousWeek: string; nextWeek: string; deadline: string; rows: TeamRow[];
  totals: { recordedMinutes: number; unsubmittedMinutes: number; submittedMinutes: number; approvedMinutes: number; withoutTime: number } };
export type Correction = { id: string; number: string; entryId: string; entryNumber: string; kind: "ADJUST" | "VOID"; original: Record<string, unknown>; proposed: Record<string, unknown>;
  reason: string; status: "REQUESTED" | "APPLIED" | "REJECTED"; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  replacementEntryId: string | null; costAdjustment: { from: string | null; to: string | null; delta?: string; currency: string | null } | null; billingAdjustmentRequired: boolean;
  billingAdjustmentReference: string | null; version: number; project: string; projectId: string; employee: string | null; can: { decide: boolean } };
export type ProjectTime = {
  projectId: string; code: string; team: boolean;
  policy: { billingMethod: string | null; billingMethodLabel: string; reference: string | null; version: number };
  totals: { recordedMinutes: number; draftMinutes: number; submittedMinutes: number; approvedMinutes: number; billableMinutes: number; approvedBillableMinutes: number };
  byTask: Array<{ taskId: string | null; task: string; estimateMinutes: number | null; recordedMinutes: number; approvedMinutes: number }>;
  byEmployee: Array<{ employeeUserId: string; employee: string | null; recordedMinutes: number; approvedMinutes: number; billableMinutes: number; cost?: string | null; currency?: string | null }>;
  cost?: { total: string; currency: string | null };
  can: { team: boolean; setBilling: boolean; record: boolean; export: boolean };
};
export type LaborRate = { id: string; userId: string; employee: string | null; projectId: string | null; project: string | null; hourlyRate: string; currency: string; effectiveFrom: string;
  effectiveTo: string | null; version: number; reason: string | null; createdBy: string | null; createdAt: string };
export type TimeSettings = { weekStart: number; dailyReviewMinutes: number; dailyLimitMinutes: number; incrementMinutes: number; deadlineDays: number; lateAllowed: boolean;
  boundaryDayPolicy: "REVIEW" | "BLOCK"; collaboratorsAllowed: boolean; timezone: string; currency: string; can: { manage: boolean } };

export const TIMESHEETS_BASE = "/projects/timesheets";
export const ENTRY_TONE: Record<EntryStatus, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", SUBMITTED: "info", APPROVED: "success", CHANGES_REQUESTED: "warning", VOIDED: "neutral" };
export const SUBMISSION_TONE: Record<SubmissionStatus, "info" | "success" | "warning"> = { SUBMITTED: "info", APPROVED: "success", CHANGES_REQUESTED: "warning" };
export const hours = (minutes: number | null | undefined) => {
  const total = Number(minutes ?? 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};
export const weekLabel = (start: string, end: string) => {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  const month = (d: Date) => d.toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)} ${b.getUTCFullYear()}` : `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)} ${b.getUTCFullYear()}`;
};

export const getWeek = (week?: string, employeeId?: string) => call<Week>(`/timesheets/my-week${qs({ week, employeeId })}`);
export const getTimeOptions = () => call<TimeOptions>("/time-entries/options");
export const getTimeTasks = (projectId: string, search?: string) => call<TimeTasks>(`/${projectId}/time-tasks${qs({ search })}`);
export const listEntries = (filters: Record<string, string | number | undefined>) => call<{ rows: TimeEntry[]; total: number; page: number; pages: number; totals: { minutes: number; total: string; billable: string } }>(`/time-entries${qs(filters)}`);
export const getEntry = (id: string) => call<{ entry: TimeEntry & { history: Array<{ id: string; action: string; summary: string | null; actor: string; at: string }>; corrections: Correction[];
  allocations: Array<{ id: string; minutes: number; status: string; invoiceNumber: string | null; reversalReason: string | null; reversalReference: string | null }> } }>(`/time-entries/${id}`).then((r) => r.entry);
export const createEntry = (input: Record<string, unknown>) => send<{ entryId: string; entryNumber: string; durationMinutes: number; explanation?: string; warnings: Warning[]; replayed?: boolean }>("/time-entries", input);
export const updateEntry = (id: string, input: Record<string, unknown>) => send<{ entryId: string; durationMinutes: number; explanation?: string; warnings: Warning[] }>(`/time-entries/${id}`, input, "PATCH");
export const removeEntry = (id: string, input: Record<string, unknown> = {}) => send<{ removed: boolean }>(`/time-entries/${id}`, input, "DELETE");
export const submitWeek = (input: Record<string, unknown>) => send<{ submissions: Array<{ submissionId: string; projectId: string; version: number; totalMinutes: number }>; late: boolean }>("/timesheets/submit", input);
export const getApprovals = (status?: string) => call<{ rows: Submission[]; pendingMinutes: number }>(`/timesheets/approvals${qs({ status })}`);
export const getSubmission = (id: string) => call<{ submission: SubmissionDetail }>(`/timesheets/${id}`).then((r) => r.submission);
export const decideSubmission = (id: string, action: "approve" | "request-changes", input: Record<string, unknown>) => send<{ status: string }>(`/timesheets/${id}/${action}`, input);
export const getTeamWeek = (week?: string, projectId?: string) => call<TeamWeek>(`/timesheets/team${qs({ week, projectId })}`);
export const remind = (input: { employeeUserId: string; projectId: string; weekStart: string }) => send<{ sent: boolean; already?: boolean }>("/timesheets/remind", input);
export const getCorrections = (status?: string) => call<{ rows: Correction[] }>(`/timesheets/corrections${qs({ status })}`);
export const requestCorrection = (entryId: string, input: Record<string, unknown>) => send<{ correctionId: string; billingAdjustmentRequired: boolean; billedMinutes: number }>(`/time-entries/${entryId}/corrections`, input);
export const decideCorrection = (id: string, action: "approve" | "reject", input: Record<string, unknown>) => send<{ status: string }>(`/timesheets/corrections/${id}/${action}`, input);
export const getProjectTime = (projectId: string) => call<{ summary: ProjectTime }>(`/${projectId}/time-summary`).then((r) => r.summary);
export const getRates = (userId?: string) => call<{ rows: LaborRate[]; can: { manage: boolean } }>(`/timesheets/rates${qs({ userId })}`);
export const setRate = (input: Record<string, unknown>) => send<{ rateId: string; version: number }>("/timesheets/rates", input);
export const recoverCosting = () => send<{ checked: number; costed: number; stillMissing: number }>("/timesheets/rates/recover", {});
export const getTimeSettings = () => call<{ settings: TimeSettings }>("/timesheets/settings").then((r) => r.settings);
export const saveTimeSettings = (input: Partial<TimeSettings>) => send<{ settings: TimeSettings }>("/timesheets/settings", input).then((r) => r.settings);
export const getTimeReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/reports/timesheets${qs({ kind, ...filters })}`).then((r) => r.rows);
export const timeExportHref = (filters: Record<string, string | undefined>) => `/api/projects/timesheets/export${qs(filters)}`;

// A command whose answer was lost (the network, not a refusal) is checked by its key before anyone is told it worked or asked to retry.
export async function runTimeCommand<T>(key: string, work: () => Promise<T>): Promise<T | { recovered: true }> {
  try {
    return await work();
  } catch (failure) {
    if (failure instanceof ProjectApiError && failure.status > 0) throw failure;
    const outcome = await call<{ outcome: { applied: boolean } }>(`/timesheets/outcome${qs({ key })}`).then((r) => r.outcome).catch(() => null);
    if (outcome?.applied) return { recovered: true };
    throw new ProjectApiError(outcome ? "The change was not applied. Check the details and try again." : "Checking the previous action. Do not submit again.", 0, "TIME_OPERATION_UNKNOWN");
  }
}
