"use client";

import type {
  Account,
  AccountDuplicateMatch,
  AccountHierarchy,
  AccountListFilters,
  AccountListResponse,
  AccountMergePreview,
  AccountPlan,
  AccountStakeholder,
  CrmListResponse,
  Customer360,
} from "../types";
import { CrmApiErrorWithBody } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class AccountApiError extends CrmApiErrorWithBody {}

const { request, parseResponse } = crmApiClient(AccountApiError, "body");

export async function listAccounts(
  filters: AccountListFilters,
): Promise<AccountListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return request(`/api/crm/accounts?${params.toString()}`);
}

export async function getAccount(id: string): Promise<{ record: Account }> {
  return request(`/api/crm/accounts/${id}`);
}

export async function createAccount(
  input: Record<string, unknown>,
): Promise<{ record: Account }> {
  return request("/api/crm/accounts", { method: "POST", json: input });
}

export async function updateAccount(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: Account }> {
  return request(`/api/crm/accounts/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}

export async function archiveAccount(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: Account }> {
  const response = await fetch(
    `/api/crm/accounts/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// F002 — hierarchy, duplicates and merge reuse the backend services in
// account-intelligence.js and duplicate-matching.js.
export async function getAccountHierarchy(
  id: string,
): Promise<AccountHierarchy> {
  return request(`/api/crm/accounts/${id}/hierarchy`);
}
export async function setAccountParent(
  id: string,
  parentId: string | null,
  reason?: string,
): Promise<{ record: Record<string, unknown> }> {
  return request(`/api/crm/accounts/${id}/hierarchy`, {
    method: "PATCH",
    json: { parentId, reason: reason || null },
  });
}

export async function findAccountDuplicates(
  input: Record<string, unknown>,
): Promise<{ duplicates: AccountDuplicateMatch[] }> {
  return request("/api/crm/accounts/duplicates", {
    method: "POST",
    json: { input },
  });
}

export async function previewAccountMerge(
  sourceId: string,
  survivorId: string,
): Promise<AccountMergePreview> {
  return request("/api/crm/accounts/merge/preview", {
    method: "POST",
    json: { sourceId, survivorId },
  });
}
export async function mergeAccounts(
  sourceId: string,
  survivorId: string,
  reason: string | null,
  fieldSelections: Record<string, "source" | "survivor">,
): Promise<{ record: Record<string, unknown> }> {
  return request("/api/crm/accounts/merge", {
    method: "POST",
    json: { sourceId, survivorId, reason, fieldSelections },
  });
}

// account-plans/account-stakeholders/communications all reuse the generic
// /api/crm/[resource] boundary, scoped by the partyId/accountPlanId filter
// keys added to buildFilters this same tranche.
export async function listAccountPlans(
  partyId: string,
): Promise<CrmListResponse<AccountPlan>> {
  return request(
    `/api/crm/account-plans?partyId=${encodeURIComponent(partyId)}&limit=5`,
  );
}
export async function createAccountPlan(
  input: Record<string, unknown>,
): Promise<{ record: AccountPlan }> {
  return request("/api/crm/account-plans", { method: "POST", json: input });
}
export async function updateAccountPlan(
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<{ record: AccountPlan }> {
  return request(`/api/crm/account-plans/${id}`, {
    method: "PATCH",
    json: { input, expectedUpdatedAt },
  });
}

export async function listAccountStakeholders(
  accountPlanId: string,
): Promise<CrmListResponse<AccountStakeholder>> {
  return request(
    `/api/crm/account-stakeholders?accountPlanId=${encodeURIComponent(accountPlanId)}&limit=100`,
  );
}
export async function createAccountStakeholder(
  input: Record<string, unknown>,
): Promise<{ record: AccountStakeholder }> {
  return request("/api/crm/account-stakeholders", {
    method: "POST",
    json: input,
  });
}
export async function archiveAccountStakeholder(
  id: string,
  expectedUpdatedAt: string,
): Promise<{ record: AccountStakeholder }> {
  const response = await fetch(
    `/api/crm/account-stakeholders/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// getCustomer360 (account-intelligence.js) already existed fully built —
// unified Account + hierarchy + Contacts + cross-module timeline — but had
// no route/frontend caller anywhere before this pass.
export async function getCustomer360(
  id: string,
): Promise<{ view: Customer360 }> {
  return request(`/api/crm/accounts/${id}/customer-360`);
}
