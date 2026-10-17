"use client";

// Projects — Progress Tracking: the client of one project's progress, its trend and change explanations, scope baselines, the portfolio,
// the progress reports and the weekly-summary setting.
import { call, qs, send } from "../api/projects-api";

export type TaskProgress = {
  state: "TRACKED" | "NO_TASKS"; measure: string; percent: number | null; label: string; text: string; total: number; done: number; toDo: number; inProgress: number; blocked: number;
  inReview: number; overdue: number; cancelled: number; openHigh: number; openUrgent: number; links: Record<"all" | "done" | "toDo" | "inProgress" | "blocked" | "inReview" | "overdue" | "cancelled", string>;
};
export type MilestoneRow = {
  id: string; code: string; name: string; status: string; approvalStatus: string; required: boolean; waived: boolean; due: string; overdue: boolean; owner: string | null; customerAcceptance: boolean;
  tasks: { total: number; done: number; percent: number | null }; blockers: number; href: string;
};
export type MilestoneProgress = {
  measure: string; total: number; completed: number; requiredTotal: number; requiredCompleted: number; percent: number | null; text: string; waived: number; pendingApproval: number; overdue: number;
  blocked: number; next: { id: string; code: string; name: string; due: string; status: string; overdue: boolean } | null; rows: MilestoneRow[];
};
export type Schedule = {
  indicator: string; label: string; remainingDays: number | null; remainingText: string | null; elapsedPercent: number | null; completedLateDays: number | null; plannedStart: string | null;
  actualStart: string | null; originalTarget: string | null; currentTarget: string | null; completedAt: string | null; holdDays: number; holds: number;
  revisions: Array<{ from: string | null; to: string | null; reason: string | null; by: string | null; at: string }>;
};
export type Change = {
  id: string; at: string; kind: string; kindLabel: string; subject: string | null; actor: string; text: string; href: string | null;
  before: { percent: number | null; done: number; total: number } | null; after: { percent: number | null; done: number; total: number };
};
export type Baseline = {
  set: boolean; code?: string; message?: string; version?: number; source?: string; capturedAt?: string; capturedBy?: string | null; reason?: string | null; baselineTasks?: number; currentTasks?: number;
  addedTasks?: number; removedTasks?: number; netTasks?: number; baselineMilestones?: number; currentMilestones?: number; addedMilestones?: number; removedMilestones?: number;
  baselineTarget?: string | null; currentTarget?: string | null; added?: Array<{ id: string; code: string; title?: string; status: string }>; removed?: Array<{ id: string; code: string; title?: string; status: string }>;
  versions: Array<{ version: number; source: string; capturedAt: string; capturedBy: string | null; reason: string | null; taskCount: number; milestoneCount: number; target: string | null }>;
};
export type AssigneeRow = { assigneeId: string | null; assignee: string; total: number; done: number; open: number; blocked: number; overdue: number; percent: number | null; needsReassignment: boolean; href: string };
export type Effort = {
  available: boolean; reason?: string; measure?: string; estimateMinutes?: number | null; estimatedTasks?: number; activeTasks?: number; coverage?: number | null; approvedMinutes?: number;
  submittedMinutes?: number; approvedBillableMinutes?: number; approvedNonBillableMinutes?: number; varianceMinutes?: number | null; note?: string | null;
};
export type ProgressSummary = {
  projectId: string; code: string; name: string | null; status: string; statusLabel: string; calculationVersion: number; calculatedAt: string; sourceEventAt: string | null;
  tasks: TaskProgress; milestones: MilestoneProgress; schedule: Schedule; health: { state: string; label: string; reasons: string[]; codes: string[]; final: boolean };
  effort: Effort; baseline: Baseline; assignees: AssigneeRow[]; changes: Change[];
  freshness: { lastRecordedAt: string | null; inSync: boolean; message: string | null };
  completion: { ready: boolean; blockers: Array<{ key: string; label: string; message: string }> } | null;
  outcome: { recorded: boolean; message?: string; at?: string; percent?: number | null; done?: number; total?: number; requiredMilestones?: number; requiredCompleted?: number; waived?: number } | null;
  can: { baseline: boolean; export: boolean; record: boolean; tasks: boolean };
};
export type HistoryPoint = { date: string; available: boolean; recorded: { done: number; total: number; percent: number | null } | null; reconstructed: { done: number; total: number; percent: number | null } | null; corrected?: boolean };
export type PortfolioRow = {
  id: string; code: string; name: string | null; manager: string | null; managerId: string | null; status: string; statusLabel: string; health: string; healthLabel: string; healthReasons: string[];
  customer: string | null; percent: number | null; done: number; total: number; blocked: number; overdue: number; inReview: number; milestonesRequired: number; milestonesCompleted: number;
  milestonePercent: number | null; target: string | null; schedule: string; scheduleLabel: string; remainingDays: number | null; attention: boolean;
};
export type Portfolio = {
  measures: { aggregate: { label: string; percent: number | null; done: number; total: number }; average: { label: string; percent: number | null; projects: number } };
  totals: { projects: number; onTrack: number; atRisk: number; blocked: number; overdue: number; dueSoon: number; noTasks: number; attention: number };
  projects: PortfolioRow[]; calculatedAt: string; can: { export: boolean };
};

export const getProgress = (projectId: string) => call<{ progress: ProgressSummary }>(`/${projectId}/progress`).then((r) => r.progress);
export const getProgressHistory = (projectId: string, interval: "week" | "day", points = 12) =>
  call<{ points: HistoryPoint[]; interval: string }>(`/${projectId}/progress/history${qs({ interval, points })}`);
export const getProgressChanges = (projectId: string, from?: string, to?: string) => call<{ summary: string; changes: Change[]; available: boolean }>(`/${projectId}/progress/changes${qs({ from, to })}`);
export const captureBaseline = (projectId: string, input: { reason: string; idempotencyKey: string }) => send<{ version: number; taskCount: number; replayed?: boolean }>(`/${projectId}/progress/baseline`, input);
export const recordProgress = (projectId: string) => send<{ consistent: boolean; message: string; eventDrift: Array<{ code: string }> }>(`/${projectId}/progress/record`, {});
export const getPortfolio = (filters: Record<string, string | undefined>) => call<Portfolio>(`/progress${qs(filters)}`);
export const progressExportHref = (filters: Record<string, string | undefined> = {}) => `/api/projects/progress/export${qs(filters)}`;
export const getProgressReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/progress${qs({ kind })}`).then((r) => r.rows);
export const getProgressSettings = () => call<{ settings: { weeklySummary: boolean; calculationVersion: number; can: { manage: boolean } } }>("/progress/settings").then((r) => r.settings);
export const saveProgressSettings = (weeklySummary: boolean) => send("/progress/settings", { weeklySummary });
export const percentLabel = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}%`);
export const hoursLabel = (minutes: number | null | undefined) => (minutes === null || minutes === undefined ? "—" : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`);
export const PROGRESS_BASE = "/projects/progress";
