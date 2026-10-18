import { createMailing, listMailings } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Campaign emails (CRM plan 5.8).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ mailings: await listMailings(client, crmContext(session, snapshot)) }));
}

// Body: { name, audience, filters?, subject, body, campaignId? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ mailing: await createMailing(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
