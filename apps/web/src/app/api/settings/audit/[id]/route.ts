import { getAuditEvent } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.auditView, action: "audit.detail", transaction: "none" }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok({ event: await getAuditEvent(client, session.organizationId, id) });
  });
}
