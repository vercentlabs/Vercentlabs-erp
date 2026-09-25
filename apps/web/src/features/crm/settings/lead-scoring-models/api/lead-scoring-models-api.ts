"use client";

import type { LeadScoringModel, LeadScoringModelRule } from "../types";

export class ScoringModelApiError extends Error {
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
    throw new ScoringModelApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listLeadScoringModels(): Promise<{ rows: LeadScoringModel[] }> {
  const response = await fetch("/api/crm/lead-scoring-models");
  return parseResponse(response);
}
export async function createLeadScoringModel(input: Record<string, unknown>): Promise<{ record: LeadScoringModel }> {
  const response = await fetch("/api/crm/lead-scoring-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateLeadScoringModel(id: string, input: Record<string, unknown>): Promise<{ record: LeadScoringModel }> {
  const response = await fetch(`/api/crm/lead-scoring-models/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function activateLeadScoringModel(id: string): Promise<{ model: LeadScoringModel; recalcJob: unknown }> {
  const response = await fetch(`/api/crm/lead-scoring-models/${id}/activate`, { method: "POST" });
  return parseResponse(response);
}
export async function trainLeadScoringModel(id: string): Promise<{ record: LeadScoringModel }> {
  const response = await fetch(`/api/crm/lead-scoring-models/${id}/train`, { method: "POST" });
  return parseResponse(response);
}
export async function createLeadScoringModelRule(modelId: string, input: Record<string, unknown>): Promise<{ record: LeadScoringModelRule }> {
  const response = await fetch(`/api/crm/lead-scoring-models/${modelId}/rules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function setLeadScoringModelRuleStatus(modelId: string, ruleId: string, status: "active" | "inactive"): Promise<{ record: LeadScoringModelRule }> {
  const response = await fetch(`/api/crm/lead-scoring-models/${modelId}/rules/${ruleId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  return parseResponse(response);
}
