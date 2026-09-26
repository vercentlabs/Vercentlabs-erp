import { revokeDeveloperApp } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Revokes the app and, in the same transaction, every one of its keys.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.developer_app.revoke", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ app: await revokeDeveloperApp(client, session, id) }),
  );
}
