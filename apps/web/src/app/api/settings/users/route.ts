import { listOrganizationMembers } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Delegated administrators receive only members entirely inside their scope
// (filtered in PostgreSQL by listOrganizationMembers).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersView, action: "settings.users.list", transaction: "none" },
    async ({ client, session }) => ok({ members: await listOrganizationMembers(client, session) }),
  );
}
