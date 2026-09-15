"use client";

import type {
  Account,
  AccountCommunication,
  AccountDuplicateMatch,
  AccountHierarchy,
  AccountListFilters,
  AccountListResponse,
  AccountMergePreview,
  AccountPlan,
  AccountStakeholder,
  CrmListResponse,
} from "../types";

export class AccountApiError extends Error {
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
    throw new AccountApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listAccounts(filters: AccountListFilters): Promise<AccountListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetch(`/api/crm/accounts?${params.toString()}`);
  return parseResponse(response);
}

export async function getAccount(id: string): Promise<{ record: Account }> {
  const response = await fetch(`/api/crm/accounts/${id}`);
  return parseResponse(response);
}

export async function createAccount(input: Record<string, unknown>): Promise<{ record: Account }> {
  const response = await fetch("/api/crm/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateAccount(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: Account }> {
  const response = await fetch(`/api/crm/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, expectedUpdatedAt }),
  });
  return parseResponse(response);
}

export async function archiveAccount(id: string, expectedUpdatedAt: string): Promise<{ record: Account }> {
  const response = await fetch(`/api/crm/accounts/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

// F002 Tranche E — hierarchy, duplicates and merge all reuse real,
// already-tested backend services (account-intelligence.js,
// duplicate-matching.js) that had no frontend wiring before this pass.
export async function getAccountHierarchy(id: string): Promise<AccountHierarchy> {
  const response = await fetch(`/api/crm/accounts/${id}/hierarchy`);
  return parseResponse(response);
}
export async function setAccountParent(id: string, parentId: string | null, reason?: string): Promise<{ record: Record<string, unknown> }> {
  const response = await fetch(`/api/crm/accounts/${id}/hierarchy`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId, reason: reason || null }),
  });
  return parseResponse(response);
}

export async function findAccountDuplicates(input: Record<string, unknown>): Promise<{ duplicates: AccountDuplicateMatch[] }> {
  const response = await fetch("/api/crm/accounts/duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  return parseResponse(response);
}

export async function previewAccountMerge(sourceId: string, survivorId: string): Promise<AccountMergePreview> {
  const response = await fetch("/api/crm/accounts/merge/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, survivorId }),
  });
  return parseResponse(response);
}
export async function mergeAccounts(
  sourceId: string,
  survivorId: string,
  reason: string | null,
  fieldSelections: Record<string, "source" | "survivor">,
): Promise<{ record: Record<string, unknown> }> {
  const response = await fetch("/api/crm/accounts/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, survivorId, reason, fieldSelections }),
  });
  return parseResponse(response);
}

// account-plans/account-stakeholders/communications all reuse the generic
// /api/crm/[resource] boundary, scoped by the partyId/accountPlanId filter
// keys added to buildFilters this same tranche.
export async function listAccountPlans(partyId: string): Promise<CrmListResponse<AccountPlan>> {
  const response = await fetch(`/api/crm/account-plans?partyId=${encodeURIComponent(partyId)}&limit=5`);
  return parseResponse(response);
}
export async function createAccountPlan(input: Record<string, unknown>): Promise<{ record: AccountPlan }> {
  const response = await fetch("/api/crm/account-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function updateAccountPlan(id: string, input: Record<string, unknown>, expectedUpdatedAt: string): Promise<{ record: AccountPlan }> {
  const response = await fetch(`/api/crm/account-plans/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, expectedUpdatedAt }) });
  return parseResponse(response);
}

export async function listAccountStakeholders(accountPlanId: string): Promise<CrmListResponse<AccountStakeholder>> {
  const response = await fetch(`/api/crm/account-stakeholders?accountPlanId=${encodeURIComponent(accountPlanId)}&limit=100`);
  return parseResponse(response);
}
export async function createAccountStakeholder(input: Record<string, unknown>): Promise<{ record: AccountStakeholder }> {
  const response = await fetch("/api/crm/account-stakeholders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}
export async function archiveAccountStakeholder(id: string, expectedUpdatedAt: string): Promise<{ record: AccountStakeholder }> {
  const response = await fetch(`/api/crm/account-stakeholders/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function listAccountCommunications(partyId: string): Promise<CrmListResponse<AccountCommunication>> {
  const response = await fetch(`/api/crm/communications?partyId=${encodeURIComponent(partyId)}&limit=25`);
  return parseResponse(response);
}
