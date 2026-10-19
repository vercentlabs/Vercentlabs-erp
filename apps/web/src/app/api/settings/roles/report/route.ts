import { roleUsageReport } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Role usage: each active role, how many active people hold it and when it last changed (roles.view).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesView, action: "settings.roles.report" },
    async ({ client, session }) => ok({ rows: await roleUsageReport(client, session) }),
  );
}
