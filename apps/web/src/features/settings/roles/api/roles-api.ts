"use client";

export class RolesApiError extends Error {
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
    throw new RolesApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export type RoleRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  module_key: string;
  risk_level: string;
  assignable: boolean;
  is_system: boolean;
  status: string;
  version: number;
  permission_keys: string[];
  assigned_user_count: number;
};

export type PermissionCatalogEntry = {
  key: string;
  name: string;
  category: string;
  description: string;
};

export async function listRoles(): Promise<{ roles: RoleRow[] }> {
  const response = await fetch("/api/settings/roles");
  return parseResponse(response);
}

export async function listPermissionCatalog(): Promise<{ permissions: PermissionCatalogEntry[] }> {
  const response = await fetch("/api/settings/roles/permissions");
  return parseResponse(response);
}

export type RoleInput = {
  name: string;
  description?: string;
  moduleKey?: string;
  riskLevel?: "standard" | "sensitive" | "privileged";
  permissionKeys: string[];
  acknowledgeWarningConflicts?: boolean;
};

export async function createRole(input: RoleInput): Promise<{ role: RoleRow }> {
  const response = await fetch("/api/settings/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateRole(roleId: string, input: Partial<RoleInput>): Promise<{ role: RoleRow }> {
  const response = await fetch(`/api/settings/roles/${roleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function archiveRole(roleId: string): Promise<{ archived: boolean }> {
  const response = await fetch(`/api/settings/roles/${roleId}`, { method: "DELETE" });
  return parseResponse(response);
}

export async function setUserRoles(
  userId: string,
  roleIds: string[],
  primaryRoleId: string,
  acknowledgeWarningConflicts?: boolean,
): Promise<{ access: unknown }> {
  const response = await fetch(`/api/settings/users/${userId}/roles`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleIds, primaryRoleId, acknowledgeWarningConflicts }),
  });
  return parseResponse(response);
}
