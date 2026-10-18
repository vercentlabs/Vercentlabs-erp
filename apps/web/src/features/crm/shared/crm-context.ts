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
// resolved workspace session.
// `snapshot` (the request's access snapshot, which workspaceRoute resolves for module routes) tells CRM which other apps the
// organization has: CRM reaches into Sales, Accounting, Projects or Support only when that app is on (data-management/apps.js).
export function crmContext(session: WorkspaceSessionContext, snapshot?: { modules: ReadonlyArray<{ moduleId: string; released: boolean; enabled: boolean; reason?: string }> } | null) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
    apps: snapshot?.modules ? snapshot.modules.filter((entry) => entry.released && entry.enabled && entry.reason !== "not_entitled").map((entry) => entry.moduleId) : undefined,
  };
}

// The dynamic half of a generic-resource mutation, for routes already inside
// workspaceRoute (which has checked session, organisation context and CRM
// module access): the resource's own manage permission, failing closed for
// anything not explicitly mapped or self-scoped. Call the billing write gate
// after this, so a caller without permission is told so first.
export function assertCrmResourceMutationPermission(
  session: WorkspaceSessionContext,
  resource: string,
) {
  const resolution = resolveCrmMutationPermission(resource);
  if (resolution.kind === "requires-permission")
    requireSessionPermission(session, resolution.permission);
  else if (resolution.kind !== "self-scoped")
    throw new HttpError(
      403,
      "You do not have permission to modify this CRM resource.",
      "PERMISSION_DENIED",
    );
}
