import { rotateWebhookSecret } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The new secret is in this response once; deliveries signed from now on use it.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.webhook.rotate_secret", transaction: "tenant", auditDenial: true },
    async ({ client, session }) => ok(await rotateWebhookSecret(client, session, id)),
  );
}
