"use client";

import type { DuplicateRule } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class DuplicateRuleApiError extends CrmApiError {}

const { request } = crmApiClient(DuplicateRuleApiError);

export async function listDuplicateRules(): Promise<{ rows: DuplicateRule[] }> {
  return request("/api/crm/duplicate-rules");
}

export async function upsertDuplicateRule(
  input: Record<string, unknown>,
): Promise<{ record: DuplicateRule }> {
  return request("/api/crm/duplicate-rules", { method: "POST", json: input });
}

export async function setDuplicateRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<{ record: DuplicateRule }> {
  return request(`/api/crm/duplicate-rules/${id}/status`, {
    method: "POST",
    json: { enabled },
  });
}
