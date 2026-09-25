"use client";

import type { DuplicateRule } from "../types";

export class DuplicateRuleApiError extends Error {
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
    throw new DuplicateRuleApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listDuplicateRules(): Promise<{ rows: DuplicateRule[] }> {
  const response = await fetch("/api/crm/duplicate-rules");
  return parseResponse(response);
}

export async function upsertDuplicateRule(input: Record<string, unknown>): Promise<{ record: DuplicateRule }> {
  const response = await fetch("/api/crm/duplicate-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function setDuplicateRuleEnabled(id: string, enabled: boolean): Promise<{ record: DuplicateRule }> {
  const response = await fetch(`/api/crm/duplicate-rules/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return parseResponse(response);
}
