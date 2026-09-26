import { listAuditActors } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.auditView, action: "audit.actors", transaction: "none" }, async ({ client, session }) =>
    ok({ actors: await listAuditActors(client, session.organizationId) }),
  );
}
