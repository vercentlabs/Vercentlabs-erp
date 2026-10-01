"use client";

import type {
  Task,
  TaskDependency,
  TaskListFilters,
  TaskListResponse,
} from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class TaskApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(TaskApiError);

export async function listTasks(
  filters: TaskListFilters,
): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return request(`/api/crm/tasks?${params.toString()}`);
}

export async function getTask(id: string): Promise<{ record: Task }> {
  return request(`/api/crm/tasks/${id}`);
}

export async function createTask(
  input: Record<string, unknown>,
): Promise<{ record: Task }> {
  return request("/api/crm/tasks", { method: "POST", json: input });
}

export async function updateTask(
  id: string,
  input: Record<string, unknown>,
): Promise<{ record: Task }> {
  return request(`/api/crm/tasks/${id}`, { method: "PATCH", json: input });
}

async function action(
  id: string,
  path: string,
  input: Record<string, unknown> = {},
): Promise<{ record: Task }> {
  return request(`/api/crm/tasks/${id}/${path}`, {
    method: "POST",
    json: input,
  });
}

export const startTask = (id: string, expectedUpdatedAt?: string) =>
  action(id, "start", { expectedUpdatedAt });
export const completeTask = (
  id: string,
  outcome?: string,
  expectedUpdatedAt?: string,
) => action(id, "complete", { outcome, expectedUpdatedAt });
export const cancelTask = (id: string, expectedUpdatedAt?: string) =>
  action(id, "cancel", { expectedUpdatedAt });
export const claimTask = (id: string, expectedUpdatedAt?: string) =>
  action(id, "claim", { expectedUpdatedAt });
export const releaseTask = (id: string, expectedUpdatedAt?: string) =>
  action(id, "release", { expectedUpdatedAt });

export async function listMyTaskTeams(): Promise<{
  teams: Array<{ id: string; name: string }>;
}> {
  return request("/api/crm/tasks/teams");
}

export async function listTaskDependencies(
  taskId: string,
): Promise<{ rows: TaskDependency[] }> {
  return request(`/api/crm/tasks/${taskId}/dependencies`);
}
export async function addTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
): Promise<{ record: TaskDependency }> {
  return request(`/api/crm/tasks/${taskId}/dependencies`, {
    method: "POST",
    json: { dependsOnTaskId },
  });
}
export async function removeTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
): Promise<{ removed: boolean }> {
  const response = await fetch(
    `/api/crm/tasks/${taskId}/dependencies/${dependsOnTaskId}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// F015 gap-closure — listCrmTaskHistory (the crm_task_events ledger) existed
// with no route or frontend caller anywhere.
export type TaskEvent = {
  id: string;
  eventType: "created" | "updated" | "started" | "completed" | "cancelled";
  fromStatus: string | null;
  toStatus: string | null;
  metadata: Record<string, unknown>;
  actorUserId: string | null;
  actorName: string | null;
  occurredAt: string;
};

export async function listTaskHistory(
  taskId: string,
): Promise<{ rows: TaskEvent[] }> {
  return request(`/api/crm/tasks/${taskId}/history`);
}
