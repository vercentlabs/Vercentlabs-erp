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
    throw new RolesApiError(
      payload.message || "The request could not be completed.",
      response.status,
      payload.code,
    );
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

export async function listPermissionCatalog(): Promise<{
  permissions: PermissionCatalogEntry[];
}> {
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
  /** The version the editor loaded; a save over a newer change is refused. */
  expectedVersion?: number;
};

export async function createRole(input: RoleInput): Promise<{ role: RoleRow }> {
  const response = await fetch("/api/settings/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function updateRole(
  roleId: string,
  input: Partial<RoleInput>,
): Promise<{ role: RoleRow }> {
  const response = await fetch(`/api/settings/roles/${roleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function archiveRole(
  roleId: string,
): Promise<{ archived: boolean }> {
  const response = await fetch(`/api/settings/roles/${roleId}`, {
    method: "DELETE",
  });
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
    body: JSON.stringify({
      roleIds,
      primaryRoleId,
      acknowledgeWarningConflicts,
    }),
  });
  return parseResponse(response);
}

export type RoleDetail = {
  role: RoleRow;
  people: Array<{ userId: string; name: string; email: string; status: string; isPrimary: boolean; assignedAt: string; assignedBy: string | null; lastSignInAt: string | null }>;
  history: Array<{ version: number; reason: string; at: string; by: string | null; name: string | null; added: string[]; removed: string[]; permissionCount: number }>;
};
export type RoleUsageRow = {
  id: string; name: string; module_key: string; risk_level: string; is_system: boolean; assignable: boolean;
  permission_count: number; active_people: number; last_changed_at: string | null;
};
export type UserAccessRow = {
  userId: string; name: string; email: string; status: string; lastSignInAt: string | null; roles: string[];
  permissionCount: number; privileged: boolean; sensitive: boolean; areas: number;
};
export type ArchivedRole = { id: string; name: string; description: string; module_key: string; risk_level: string; updated_at: string };

export async function getRoleDetail(roleId: string): Promise<RoleDetail> {
  return parseResponse(await fetch(`/api/settings/roles/${roleId}`));
}
export async function duplicateRole(roleId: string, input: { name?: string } = {}): Promise<{ role: RoleRow }> {
  return parseResponse(await fetch(`/api/settings/roles/${roleId}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
}
export async function restoreRole(roleId: string): Promise<{ role: RoleRow }> {
  return parseResponse(await fetch(`/api/settings/roles/${roleId}/restore`, { method: "POST" }));
}
export async function listArchivedRoles(): Promise<{ roles: ArchivedRole[] }> {
  return parseResponse(await fetch("/api/settings/roles/archived"));
}
export async function getRoleUsageReport(): Promise<{ rows: RoleUsageRow[] }> {
  return parseResponse(await fetch("/api/settings/roles/report"));
}
export async function getUserAccessReport(): Promise<{ rows: UserAccessRow[] }> {
  return parseResponse(await fetch("/api/settings/users/access-report"));
}
