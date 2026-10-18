import "server-only";

import type { WorkspaceSessionContext } from "@/core/session";

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
