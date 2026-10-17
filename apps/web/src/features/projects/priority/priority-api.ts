"use client";

// Projects — Priority: the four levels (highest first) with what each means, the reason rule, and the client of the priority commands and
// reports. One model for projects, milestones and tasks.
import { call, milestoneAction, qs, send, taskAction, type Priority } from "../api/projects-api";

export const PRIORITIES: Priority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];
export const PRIORITY_DESCRIPTION: Record<Priority, string> = { URGENT: "Needs immediate attention", HIGH: "Important work", NORMAL: "Standard work", LOW: "Flexible work" };
// Raising to Urgent, or lowering from it, needs a reason.
export const priorityNeedsReason = (from: Priority | null | undefined, to: Priority) => Boolean(from) && from !== to && (from === "URGENT" || to === "URGENT");

export type PriorityCounts = Record<Priority, number>;
export type PriorityChange = { priority: Priority; version: number; changed: boolean; replayed?: boolean };
export type PriorityTarget = { kind: "task" | "milestone" | "project"; id: string; code: string; name: string; priority: Priority; version: number };
type ChangeInput = { priority: Priority; reason?: string; expectedVersion?: number; idempotencyKey?: string };

// The record's own priority command (it changes nothing else).
export function setPriority(target: Pick<PriorityTarget, "kind" | "id">, input: ChangeInput) {
  if (target.kind === "task") return taskAction<PriorityChange>(target.id, "priority", input);
  if (target.kind === "milestone") return milestoneAction<PriorityChange>(target.id, "priority", input);
  return send<PriorityChange>(`/${target.id}/priority`, input);
}

export type PriorityChangeRow = {
  entity: "PROJECT" | "MILESTONE" | "TASK"; entityId: string; code: string; name: string; projectCode: string; from: Priority | null; to: Priority | null;
  fromLabel: string | null; toLabel: string | null; reason: string | null; actor: string | null; at: string;
};
export const getPriorityReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/reports/priorities${qs({ kind, ...filters })}`).then((r) => r.rows);
