import type { SessionContext } from "@/lib/auth";
import { requireWorkspace } from "@/lib/auth";
import { HttpError } from "@/lib/http";

export const PERMISSIONS = {
  workspaceView: "workspace.view",
  organizationManage: "organization.manage",
  companyManage: "company.manage",
  branchManage: "branch.manage",
  departmentManage: "department.manage",
  costCenterManage: "cost_center.manage",
  teamManage: "team.manage",
  usersView: "users.view",
  usersManage: "users.manage",
  rolesManage: "roles.manage",
  auditView: "audit.view",
  notificationsView: "notifications.view",
  modulesManage: "modules.manage",
  numberingManage: "numbering.manage",
  approvalsManage: "approvals.manage",
  profileManage: "profile.manage",
  sessionsManage: "sessions.manage",
} as const;

export function hasPermission(session: SessionContext, permission: string) {
  return (
    session.roleSlugs.includes("organization_owner") ||
    session.permissions.includes(permission)
  );
}

export async function requirePermission(permission: string) {
  const session = await requireWorkspace();
  if (!hasPermission(session, permission))
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
    );
  return session;
}

export function requirePermissionFromSession(
  session: SessionContext,
  permission: string,
) {
  if (!hasPermission(session, permission))
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
    );
}
