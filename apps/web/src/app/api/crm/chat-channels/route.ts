import { createChatChannel, listChatChannels } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Website chats (CRM plan 5.8).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ channels: await listChatChannels(client, crmContext(session, snapshot)) }));
}

// Body: { name, welcomeMessage?, allowedOrigins?, ownerUserId? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ channel: await createChatChannel(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
