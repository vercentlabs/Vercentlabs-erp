"use client";

import type { Account, AccountListFilters, AccountListResponse } from "../types";

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
