import { listArchivedRoles } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Archived custom roles, for restoring one (roles.view).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesView, action: "settings.roles.archived" },
    async ({ client, session }) => ok({ roles: await listArchivedRoles(client, session) }),
  );
}
