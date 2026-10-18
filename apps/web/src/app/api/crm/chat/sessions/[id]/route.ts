import { closeChat, getChatSession, replyToChat } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ chat: await getChatSession(client, crmContext(session, snapshot), id) }));
}

// Body: { body } to reply, or { close: true }.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const body = await readBody(request);
    return ok({ chat: body.close === true ? await closeChat(client, context, id) : await replyToChat(client, context, id, String(body.body ?? "")) });
  });
}
