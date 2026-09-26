import { listWebhookDeliveries } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const status = new URL(request.url).searchParams.get("status");
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.integrationsView, action: "integrations.webhook.deliveries", transaction: "tenant" }, async ({ client, session }) =>
    ok({ deliveries: await listWebhookDeliveries(client, session.organizationId, { subscriptionId: id, status: status && ["pending", "processing", "retry", "delivered", "dead"].includes(status) ? status : null }) }),
  );
}
