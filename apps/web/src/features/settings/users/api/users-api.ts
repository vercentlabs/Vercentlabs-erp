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

// Access is returned as ids AND names by the server; ids are identity, names
// are display only.
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
  primary_role_name: string | null;
  company_ids: string[];
  company_names: string[];
  branch_ids: string[];
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
