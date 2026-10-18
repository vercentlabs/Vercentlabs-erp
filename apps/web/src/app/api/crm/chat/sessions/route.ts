import { listChatSessions } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The chat inbox (CRM plan 5.8): ?status=open|closed|all
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? "open";
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ sessions: await listChatSessions(client, crmContext(session, snapshot), { status }) }));
}
