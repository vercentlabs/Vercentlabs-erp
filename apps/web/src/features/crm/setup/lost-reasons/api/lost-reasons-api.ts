"use client";

import type { CrmListResponse, CrmOutcomeReason } from "../types";
import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class OutcomeReasonApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(OutcomeReasonApiError);

export async function listOutcomeReasons(): Promise<
  CrmListResponse<CrmOutcomeReason>
> {
  return request("/api/crm/lost-reasons?limit=200");
}
export async function createOutcomeReason(
  input: Record<string, unknown>,
): Promise<{ record: CrmOutcomeReason }> {
  return request("/api/crm/lost-reasons", { method: "POST", json: input });
}
export async function archiveOutcomeReason(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: CrmOutcomeReason }> {
  const response = await fetch(
    `/api/crm/lost-reasons/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}
export async function updateOutcomeReason(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: CrmOutcomeReason }> {
  return request(`/api/crm/lost-reasons/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}
