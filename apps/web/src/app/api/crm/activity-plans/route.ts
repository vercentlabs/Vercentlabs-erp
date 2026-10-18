import { createActivityPlan, listActivityPlans } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Activity plans (CRM plan 5.2): ?appliesTo=lead|opportunity lists those usable there; ?all=1 includes switched-off ones (managers).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ plans: await listActivityPlans(client, crmContext(session, snapshot), { includeInactive: params.get("all") === "1", appliesTo: params.get("appliesTo") || null }) }));
}

// Body: { name, description?, appliesTo?, steps: [{ activityTypeId, offsetDays, subject?, assignee?, userId? }] }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ plan: await createActivityPlan(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
