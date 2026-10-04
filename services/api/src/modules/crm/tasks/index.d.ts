import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;
type CodeLabel<Code extends string = string> = { code: Code; label: string };

export type TaskStatus = "open" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high";
export type TaskRelatedType = "lead" | "party" | "contact" | "opportunity";
export type TaskViewKey = "mine" | "due_today" | "upcoming" | "overdue" | "high_priority" | "completed" | "created_by_me" | "team" | "all" | "cancelled";
export type TaskCapabilities = Record<
  "view" | "viewTeam" | "viewAll" | "create" | "edit" | "complete" | "reopen" | "cancel" | "delete" | "assign" | "reassign" | "export",
  boolean
>;
// A task as the operations return it (see toTask in records.js).
export type Task = Record<string, any> & {
  id: string; number: string | null; title: string; status: TaskStatus; priority: TaskPriority; assignedTo: string | null; dueDate: string | null;
  dueTime: string | null; isOverdue: boolean; updatedAt: string;
};
export type TaskBulkResult = { results: Array<{ taskId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };

export const TASK_STATUSES: ReadonlyArray<CodeLabel<TaskStatus>>;
export const TASK_PRIORITIES: ReadonlyArray<CodeLabel<TaskPriority>>;
export const TASK_RELATED_TYPES: ReadonlyArray<CodeLabel<TaskRelatedType>>;
export const TASK_REMINDER_OPTIONS: ReadonlyArray<{ minutes: number; label: string }>;
export const TASK_VIEWS: ReadonlyArray<{ key: TaskViewKey; label: string }>;
export const TASK_PERMISSIONS: Readonly<Record<keyof TaskCapabilities, string>>;
export const TASK_NUMBER_DOCUMENT_TYPE: string;
export const STORED_STATUS: Readonly<Record<TaskStatus, string>>;
export const OPEN_STORED_STATUSES: ReadonlyArray<string>;

export function taskCan(context: CrmContext, permission: string): boolean;
export function canViewAllTasks(context: CrmContext): boolean;
export function taskScopeSql(context: CrmContext, values: unknown[], alias?: string): string;
export function taskCapabilities(context: CrmContext): TaskCapabilities;

export function listTasks(client: QueryClient, context: CrmContext, filters?: Input): Promise<{ tasks: Task[]; total: number; limit: number; offset: number; capabilities: TaskCapabilities }>;
export function getTask(client: QueryClient, context: CrmContext, taskId: string): Promise<Task>;
export function getTaskSummary(client: QueryClient, context: CrmContext): Promise<{ overdue: number; dueToday: number; upcoming: number; highPriority: number; open: number; teamOverdue: number | null }>;
export function getTaskOptions(client: QueryClient, context: CrmContext): Promise<Record<string, any>>;
export function createTask(client: QueryClient, context: CrmContext, input?: Input): Promise<Task>;
export function updateTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input): Promise<Task>;
export function rescheduleTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input): Promise<Task>;
export function deleteTask(client: QueryClient, context: CrmContext, taskId: string): Promise<{ deleted: boolean }>;

export function assignTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input, options?: { notify?: boolean }): Promise<{ changed: boolean }>;
export function reassignTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input, options?: { notify?: boolean }): Promise<{ changed: boolean }>;
export function startTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input): Promise<{ changed: boolean }>;
export function completeTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input): Promise<{ changed: boolean; followUpId: string | null }>;
export function reopenTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input): Promise<{ changed: boolean }>;
export function cancelTask(client: QueryClient, context: CrmContext, taskId: string, input?: Input): Promise<{ changed: boolean }>;
export function listTaskHistory(client: QueryClient, context: CrmContext, taskId: string): Promise<Array<{ id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null }>>;
export function bulkUpdateTasks(client: QueryClient, context: CrmContext, input?: Input): Promise<TaskBulkResult>;
export function bulkAssignTasks(client: QueryClient, context: CrmContext, input?: Input): Promise<TaskBulkResult>;
export function settleOpenTasks(client: QueryClient, context: CrmContext, entityType: string, entityId: string, options?: { action?: "keep" | "cancel"; reason?: string | null }): Promise<{ cancelled: number }>;
export function exportTasks(client: QueryClient, context: CrmContext, filters?: Input): Promise<{ fileName: string; rowCount: number; csv: string }>;
