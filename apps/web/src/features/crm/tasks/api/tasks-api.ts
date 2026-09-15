"use client";

import type { Task, TaskDependency, TaskListFilters, TaskListResponse } from "../types";

export class TaskApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new TaskApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listTasks(filters: TaskListFilters): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/tasks?${params.toString()}`);
  return parseResponse(response);
}

export async function getTask(id: string): Promise<{ record: Task }> {
  const response = await fetch(`/api/crm/tasks/${id}`);
  return parseResponse(response);
}

export async function createTask(input: Record<string, unknown>): Promise<{ record: Task }> {
  const response = await fetch("/api/crm/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateTask(id: string, input: Record<string, unknown>): Promise<{ record: Task }> {
  const response = await fetch(`/api/crm/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

async function action(id: string, path: string, input: Record<string, unknown> = {}): Promise<{ record: Task }> {
  const response = await fetch(`/api/crm/tasks/${id}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export const startTask = (id: string, expectedUpdatedAt?: string) => action(id, "start", { expectedUpdatedAt });
export const completeTask = (id: string, outcome?: string, expectedUpdatedAt?: string) => action(id, "complete", { outcome, expectedUpdatedAt });
export const cancelTask = (id: string, expectedUpdatedAt?: string) => action(id, "cancel", { expectedUpdatedAt });
export const claimTask = (id: string, expectedUpdatedAt?: string) => action(id, "claim", { expectedUpdatedAt });
export const releaseTask = (id: string, expectedUpdatedAt?: string) => action(id, "release", { expectedUpdatedAt });

export async function listMyTaskTeams(): Promise<{ teams: Array<{ id: string; name: string }> }> {
  const response = await fetch("/api/crm/tasks/teams");
  return parseResponse(response);
}

export async function listTaskDependencies(taskId: string): Promise<{ rows: TaskDependency[] }> {
  const response = await fetch(`/api/crm/tasks/${taskId}/dependencies`);
  return parseResponse(response);
}
export async function addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<{ record: TaskDependency }> {
  const response = await fetch(`/api/crm/tasks/${taskId}/dependencies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dependsOnTaskId }),
  });
  return parseResponse(response);
}
export async function removeTaskDependency(taskId: string, dependsOnTaskId: string): Promise<{ removed: boolean }> {
  const response = await fetch(`/api/crm/tasks/${taskId}/dependencies/${dependsOnTaskId}`, { method: "DELETE" });
  return parseResponse(response);
}
