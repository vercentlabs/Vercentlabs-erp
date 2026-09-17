"use client";

import type { LeadStage, LeadStageTransition, LeadStageTransitionReason } from "../types";

export class LeadLifecycleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new LeadLifecycleApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload.details);
  }
  return payload;
}

export async function listLeadStages(status: "active" | "inactive" | "all" = "all"): Promise<{ rows: LeadStage[]; total: number }> {
  const response = await fetch(`/api/crm/lead-stages?status=${status}`);
  return parseResponse(response);
}
export async function createLeadStage(input: Record<string, unknown>): Promise<{ record: LeadStage }> {
  const response = await fetch("/api/crm/lead-stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateLeadStage(id: string, input: Record<string, unknown>): Promise<{ record: LeadStage }> {
  const response = await fetch(`/api/crm/lead-stages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function reactivateLeadStage(id: string): Promise<{ record: LeadStage }> {
  const response = await fetch(`/api/crm/lead-stages/${id}/reactivate`, { method: "POST" });
  return parseResponse(response);
}
export async function deactivateLeadStage(id: string, migrateToStageId?: string): Promise<{ deactivated: boolean; stage: LeadStage; migrationJob?: unknown }> {
  const response = await fetch(`/api/crm/lead-stages/${id}/deactivate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ migrateToStageId }) });
  return parseResponse(response);
}

export async function listLeadStageTransitions(): Promise<{ rows: LeadStageTransition[] }> {
  const response = await fetch("/api/crm/lead-stage-transitions");
  return parseResponse(response);
}
export async function addLeadStageTransition(fromStageId: string, toStageId: string, reasonRequired: boolean): Promise<{ record: unknown }> {
  const response = await fetch("/api/crm/lead-stage-transitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromStageId, toStageId, reasonRequired }) });
  return parseResponse(response);
}
export async function removeLeadStageTransition(fromStageId: string, toStageId: string): Promise<{ removed: boolean }> {
  const response = await fetch(`/api/crm/lead-stage-transitions/${fromStageId}/${toStageId}`, { method: "DELETE" });
  return parseResponse(response);
}

export type LeadStageTemplatePreview = {
  stagesToCreate: Array<{ code: string; name: string; description: string }>;
  labelsToChange: unknown[];
  edgesToAdd: Array<{ fromCode: string; toCode: string }>;
  edgesToRemove: unknown[];
  affectedLeadCount: number;
  requiresLeadMigration: boolean;
  conflicts: Array<{ code: string; issue: string }>;
};

export async function previewLeadStageTemplateUpgrade(): Promise<LeadStageTemplatePreview> {
  const response = await fetch("/api/crm/lead-stages/recommended-template");
  return parseResponse(response);
}
export async function applyLeadStageTemplateUpgrade(): Promise<{
  applied: boolean;
  stagesCreated: Array<{ code: string; name: string; description: string }>;
  edgesAdded: Array<{ fromCode: string; toCode: string }>;
}> {
  const response = await fetch("/api/crm/lead-stages/recommended-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
  return parseResponse(response);
}

export async function listLeadStageTransitionReasons(): Promise<{ rows: LeadStageTransitionReason[] }> {
  const response = await fetch("/api/crm/lead-stage-transition-reasons");
  return parseResponse(response);
}
export async function createLeadStageTransitionReason(input: Record<string, unknown>): Promise<{ record: LeadStageTransitionReason }> {
  const response = await fetch("/api/crm/lead-stage-transition-reasons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function setLeadStageTransitionReasonActive(id: string, active: boolean): Promise<{ record: LeadStageTransitionReason }> {
  const response = await fetch(`/api/crm/lead-stage-transition-reasons/${id}/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
  return parseResponse(response);
}
