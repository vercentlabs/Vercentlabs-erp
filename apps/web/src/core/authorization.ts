import type { SessionContext, WorkspaceSessionContext } from "@/core/auth";
import { getSessionContext, requireWorkspace } from "@/core/auth";
import { HttpError } from "@/core/http";
import { PERMISSIONS } from "@/core/permissions";

// Re-exported unchanged so every existing `import { PERMISSIONS } from
// "@/lib/authorization"` call site keeps working — the constant itself now
// lives in permissions-catalog.ts, which (unlike this file) has no
// @/lib/auth dependency and is safe for Client Components to import
// (see that file's header comment and docs/implementation/
// ERP_NAVIGATION_FOUNDATION_006.md).
export { PERMISSIONS };


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

export async function requireApiPermission(
  permission: string,
): Promise<WorkspaceSessionContext> {
  const session = await getSessionContext();
  if (!session) throw new HttpError(401, "Authentication is required.");
  if (!session.emailVerified) {
    throw new HttpError(403, "Verify your email before using this workspace.");
  }
  if (!session.organizationId) {
    throw new HttpError(409, "Complete organisation onboarding first.");
  }
  if (!hasPermission(session, permission)) {
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
    );
  }
  return session as WorkspaceSessionContext;
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
