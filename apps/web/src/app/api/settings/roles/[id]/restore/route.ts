import { restoreRole } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// An archived custom role in use again (roles.manage).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesManage, action: "settings.roles.restore", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      return ok({ role: await restoreRole(client, session, id) });
    },
  );
}
