import { revokeOAuthConnection } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Revokes a connection and wipes its stored credentials. Integration
// administrators may revoke any connection in the organisation.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.oauth.revoke", auditDenial: true },
    async ({ client, session }) => ok({ connection: await revokeOAuthConnection(client, session, id, { administrator: true }) }),
  );
}
