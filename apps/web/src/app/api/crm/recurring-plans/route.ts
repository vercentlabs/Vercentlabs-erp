import { createRecurringPlan, listRecurringPlans } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Recurring plans (CRM plan 5.3); ?all=1 includes switched-off ones (CRM settings managers).
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ plans: await listRecurringPlans(client, crmContext(session, snapshot), { includeInactive }) }));
}

// Body: { name, months }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ plan: await createRecurringPlan(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
