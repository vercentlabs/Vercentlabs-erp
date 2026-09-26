import { z } from "zod";

import { createWebhookSubscription, DOMAIN_EVENTS, listWebhookSubscriptions } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Integrations > Webhooks. Only registered events can be chosen.
// The signing secret is in the create response once and never again.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.integrationsView, action: "integrations.webhooks.list" }, async ({ client, session }) =>
    ok({
      subscriptions: await listWebhookSubscriptions(client, session.organizationId),
      events: DOMAIN_EVENTS.map((event) => ({ key: event.key, moduleKey: event.moduleKey, label: event.label, description: event.description })),
    }),
  );
}

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  endpointUrl: z.string().trim().min(1).max(2000),
  eventTypes: z.array(z.string().max(120)).min(1).max(50),
});

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.webhook.create", auditDenial: true },
    async ({ client, session }) => ok(await createWebhookSubscription(client, session, schema.parse(await readJson(request))), 201),
  );
}
