import { userAccessReport } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// User access: each member, their roles and how much they can do, with sensitive and privileged access flagged (users.view).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersView, action: "settings.users.access_report" },
    async ({ client, session }) => ok({ rows: await userAccessReport(client, session) }),
  );
}
