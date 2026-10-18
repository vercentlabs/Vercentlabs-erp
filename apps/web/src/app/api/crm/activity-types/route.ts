import { createActivityType, listActivityTypes } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The organization's activity types (CRM plan 5.2), in order; ?all=1 includes switched-off ones (for CRM settings managers).
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ types: await listActivityTypes(client, crmContext(session, snapshot), { includeInactive }) }));
}

// Body: { name, kind, icon?, defaultDelayHours?, defaultAssignee?, defaultUserId?, defaultReminderMinutes?, emailTemplateId?, chaining?, nextTypeId?, nextDelayDays? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ type: await createActivityType(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
