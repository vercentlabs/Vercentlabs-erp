import { redeliverWebhookDelivery } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Sends one failed delivery again (same event and delivery id; recorded as a redelivery).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.webhook.redeliver", auditDenial: true },
    async ({ client, session }) => ok({ delivery: await redeliverWebhookDelivery(client, session, id) }),
  );
}
