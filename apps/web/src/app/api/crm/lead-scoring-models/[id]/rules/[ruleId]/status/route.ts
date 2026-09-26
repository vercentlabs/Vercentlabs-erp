import { setLeadScoringModelRuleStatus } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string; ruleId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id, ruleId } = await context.params;
    const body = (await readJson(request)) as { status?: "active" | "inactive" };
    const record = await setLeadScoringModelRuleStatus(client, crmContext(session), id, ruleId, body.status === "active" ? "active" : "inactive");
    return ok({ record });
  });
}
