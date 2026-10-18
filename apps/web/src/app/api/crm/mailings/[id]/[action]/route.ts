import { cancelMailing, scheduleMailing } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// POST schedule { scheduledAt? } (now when absent) · POST cancel
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!["schedule", "cancel"].includes(action)) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    if (action === "cancel") return ok({ mailing: await cancelMailing(client, context, id) });
    const body = await readBody(request);
    return ok({ mailing: await scheduleMailing(client, context, id, { scheduledAt: body.scheduledAt ? String(body.scheduledAt) : null }) });
  });
}
