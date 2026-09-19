"use client";

export class UsersApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new UsersApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type MemberRow = {
  user_id: string;
  email: string;
  full_name: string;
  user_status: string;
  membership_role: string;
  membership_status: "active" | "disabled";
  joined_at: string;
  role_names: string[];
  role_ids: string[];
  primary_role_id: string | null;
  company_names: string[];
  branch_names: string[];
};

export async function listMembers(): Promise<{ members: MemberRow[] }> {
  const response = await fetch("/api/settings/users");
  return parseResponse(response);
}

export async function setMemberStatus(userId: string, status: "active" | "disabled"): Promise<{ userId: string; status: string }> {
  const response = await fetch(`/api/settings/users/${userId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return parseResponse(response);
}

export async function setMemberAccess(userId: string, companyIds: string[], branchIds: string[]): Promise<{ companyIds: string[]; branchIds: string[] }> {
  const response = await fetch(`/api/settings/users/${userId}/access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyIds, branchIds }),
  });
  return parseResponse(response);
}
