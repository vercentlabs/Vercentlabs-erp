import "server-only";

import { requireSessionPermission } from "@vercentlabs/api";

// Relative, not the "@/" alias: that alias is a tsconfig-only path that
// only Next's bundler resolves, not plain `node --test`. This file starts
// with `import "server-only"` (throws unconditionally outside Next's
// server runtime) so it can never itself be imported by a plain-node
// test — resolveCrmMutationPermission below is the actual deny-by-default
// decision logic, kept pure and alias-free in resource-permissions.ts
// specifically so it's unit-testable; this function is a thin wrapper.
import { HttpError } from "../../../core/http-errors.ts";
import type { WorkspaceSessionContext } from "@/core/session";
import { resolveCrmMutationPermission } from "./resource-permissions.ts";

// Builds the CrmContext shape services/api/src/modules/crm/*.js functions
// expect (@vercentlabs/shared-types' CrmContext), from the already-
// resolved workspace session — the same allowAllCompanies computation
// used everywhere else in the shell (services/api/src/core/approvals.js,
// the ported access-administration module).
export function crmContext(session: WorkspaceSessionContext) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

export type CrmApiContext = ReturnType<typeof crmContext>;

// Loads a record for an edit page inside the tenant-scoped transaction (row-level security needs
// app.current_organization_id; a bare connection sees no rows, which is how every existing record used to
// appear "not found" on its edit screen). Only a genuine 404 becomes notFound; any other failure (database
// down, module disabled, billing) surfaces as an error instead of being disguised as a missing record.
export async function loadRecordForEdit<T>(
  session: WorkspaceSessionContext,
  load: (client: import("pg").PoolClient) => Promise<T>,
): Promise<{ record: T | null; notFound: boolean }> {
  const { workspaceModuleTransaction } = await import("@/core/access");
  try {
    const record = await workspaceModuleTransaction(session, { module: "crm" }, load);
    return { record, notFound: false };
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) return { record: null, notFound: true };
    throw error;
  }
}

// The dynamic half of a generic-resource mutation, for routes already inside
// workspaceRoute (which has checked session, organisation context and CRM
// module access): the resource's own manage permission, failing closed for
// anything not explicitly mapped or self-scoped. Call the billing write gate
// after this, so a caller without permission is told so first.
export function assertCrmResourceMutationPermission(session: WorkspaceSessionContext, resource: string) {
  const resolution = resolveCrmMutationPermission(resource);
  if (resolution.kind === "requires-permission") requireSessionPermission(session, resolution.permission);
  else if (resolution.kind !== "self-scoped") throw new HttpError(403, "You do not have permission to modify this CRM resource.", "PERMISSION_DENIED");
}
