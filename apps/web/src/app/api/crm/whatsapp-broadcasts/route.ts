import { createBroadcast, listBroadcasts } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// WhatsApp broadcasts (CRM audit M2).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ broadcasts: await listBroadcasts(client, crmContext(session, snapshot)) }));
}

// Body: { name, audience, filters?, templateName, templateLanguage?, parameters?, campaignId? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ broadcast: await createBroadcast(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
