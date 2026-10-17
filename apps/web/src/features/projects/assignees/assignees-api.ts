"use client";

// Projects — Assignees: the client of the assignee reads (who may be given a project's tasks, the team's workload, a task's assignment history,
// what a member still owns before leaving). Reassigning is the task's own "assign" command (taskAction).
import { call, qs } from "../api/projects-api";

export type AssigneeLoad = { open: number; inProgress: number; overdue: number; dueThisWeek: number; highPriority: number; estimateMinutes: number; estimatedTasks: number; projects: number };
export type EligibleAssignee = { userId: string; name: string; email: string; role: string; roleLabel: string; project: AssigneeLoad; overall: AssigneeLoad };
export type TeamWorkload = {
  projectId: string; projectCode: string; members: Array<{ userId: string; name: string; roleLabel: string; overallOpen: number; overallProjects: number } & AssigneeLoad>;
  needsOwner: Array<{ userId: string; name: string } & AssigneeLoad>; unestimatedOpenTasks: number; note: string;
};
export type AssignmentHistoryEntry = {
  id: string; action: string; at: string; by: string; from: string | null; to: string | null; reasonCode: string | null; reason: string | null; reasonText: string | null; summary: string | null;
};
export type AssignmentImpact = {
  memberId: string; userId: string; openTasks: Array<{ id: string; code: string; title: string; status: string; dueDate: string | null }>;
  reviews: Array<{ id: string; code: string; title: string }>; blockers: Array<{ id: string; taskCode: string; description: string }>;
  milestones: Array<{ id: string; code: string; name: string }>; clear: boolean; note: string;
};

// Why a task is reassigned (the server's ASSIGNMENT_REASONS). "Other" needs words of its own.
export const ASSIGNMENT_REASON_LABEL: Record<string, string> = {
  WORKLOAD_BALANCING: "Balancing the workload", UNAVAILABLE: "The assignee is unavailable", LEFT_PROJECT: "The assignee left the project",
  SKILLS: "Better suited to someone else", PRIORITY_CHANGE: "Priorities changed", OTHER: "Other",
};

export const getEligibleAssignees = (projectId: string, search = "") =>
  call<{ assignees: EligibleAssignee[] }>(`/${projectId}/eligible-assignees${qs({ search })}`).then((r) => r.assignees);
export const getTeamWorkload = (projectId: string) => call<{ workload: TeamWorkload }>(`/${projectId}/assignee-workload`).then((r) => r.workload);
export const getAssignmentHistory = (taskId: string) => call<{ history: AssignmentHistoryEntry[] }>(`/tasks/${taskId}/assignment-history`).then((r) => r.history);
export const getAssignmentImpact = (projectId: string, memberId: string) =>
  call<{ impact: AssignmentImpact }>(`/${projectId}/members/${memberId}/assignment-impact`).then((r) => r.impact);
