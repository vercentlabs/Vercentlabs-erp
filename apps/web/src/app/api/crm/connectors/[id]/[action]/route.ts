import { listLeadConnectorEvents, pullLeadConnectorNow, rotateLeadConnectorWebhook, setLeadConnectorStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string; action: string }> };

// GET events: the leads the connector received, newest first, and what became of each.
export async function GET(request: Request, { params }: Params) {
  const { id, action } = await params;
  if (action !== "events") return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage }, async ({ client, session, snapshot }) =>
    ok({ events: await listLeadConnectorEvents(client, crmContext(session, snapshot), id) }));
}

// POST status { status: "active" | "paused" }; POST rotate — a new webhook address (its key in the response once); POST pull — "Read now"
// for IndiaMART and TradeIndia.
export async function POST(request: Request, { params }: Params) {
  const { id, action } = await params;
  if (!["status", "rotate", "pull"].includes(action)) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    if (action === "rotate") return ok(await rotateLeadConnectorWebhook(client, context, id));
    if (action === "pull") return ok({ result: await pullLeadConnectorNow(client, context, id) });
    const body = await readBody(request);
    return ok({ connector: await setLeadConnectorStatus(client, context, id, body.status === "active" ? "active" : "paused") });
  });
}
