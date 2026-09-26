"use client";

export class AccessApiError extends Error {
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
    throw new AccessApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export type GrantableRole = {
  id: string;
  name: string;
  slug: string;
  description: string;
  module_key: string;
  risk_level: "standard" | "sensitive" | "privileged";
  is_system: boolean;
  permission_keys: string[];
  grantable: boolean;
  reason: "ownership_transfer_only" | "not_assignable" | "module_disabled" | "exceeds_your_access" | null;
};

export type GrantableCompany = { id: string; name: string; code: string; branches: Array<{ id: string; name: string; code: string }> };
export type GrantableDepartment = { id: string; name: string; code: string; companyId: string | null };
export type GrantableTeam = { id: string; name: string; code: string; departmentId: string | null };

export type AccessOptions = {
  scope: { unrestricted: boolean; companies: GrantableCompany[]; departments: GrantableDepartment[]; teams: GrantableTeam[] } | null;
  roles: GrantableRole[];
  abilities: { canManageUsers: boolean; canAssignRoles: boolean };
};

export async function getAccessOptions(): Promise<AccessOptions> {
  return parseResponse(await fetch("/api/settings/access/options"));
}

export async function saveUserAccessScope(userId: string, scope: { companyIds: string[]; branchIds: string[]; departmentIds: string[]; teamIds: string[] }): Promise<{ access: unknown }> {
  return parseResponse(
    await fetch(`/api/settings/users/${userId}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope),
    }),
  );
}
