import { z } from "zod";

import { updateWebhookSubscription } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  endpointUrl: z.string().trim().min(1).max(2000).optional(),
  eventTypes: z.array(z.string().max(120)).min(1).max(50).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.webhook.update", transaction: "tenant", auditDenial: true },
    async ({ client, session }) => ok({ subscription: await updateWebhookSubscription(client, session, id, schema.parse(await readJson(request))) }),
  );
}
