import { assertSameOriginOrMobile, setLeadScoringModelRuleStatus } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string; ruleId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, ruleId } = await context.params;
    const body = (await readJson(request)) as { status?: "active" | "inactive" };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return setLeadScoringModelRuleStatus(client, crmContext(session), id, ruleId, body.status === "active" ? "active" : "inactive");
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
