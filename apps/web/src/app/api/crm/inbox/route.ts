import { listInbox } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The CRM Inbox: chats, WhatsApp messages and emails from customers. ?channel=all|chat|whatsapp|email&days=
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const params = new URL(request.url).searchParams;
    return ok(await listInbox(client, crmContext(session, snapshot), { channel: params.get("channel") ?? undefined, days: Number(params.get("days")) || undefined }));
  });
}
