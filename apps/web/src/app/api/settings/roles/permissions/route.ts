import { listPermissionCatalog } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Platform read: the permission catalogue lives in public tables, so a
// single pooled client (no tenant transaction) is enough. listPermissionCatalog
// re-checks roles.manage itself — the route check is not the only gate.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesManage, action: "settings.permissions.list" },
    async ({ client, session }) => ok({ permissions: await listPermissionCatalog(client, session) }),
  );
}
