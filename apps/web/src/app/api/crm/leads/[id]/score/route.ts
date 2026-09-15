import { assertSameOriginOrMobile, getLeadScoreExplanation, recalculateLeadScore } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F027 scoring is read-only intelligence — it must never be treated as
// lifecycle authority. Recalculation only re-derives score/grade from the
// active model; it can never change status/qualificationStatus/recordStatus.
// Both functions already check crm.leads.view_sensitive internally
// (assertSensitiveLeadIntelligenceAccess); this route still enforces the
// module-access layer.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const explanation = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return getLeadScoreExplanation(client, crmContext(session), id);
    });
    return ok({ explanation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as { reason?: string };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return recalculateLeadScore(client, crmContext(session), id, input.reason || "Manual recalculation from Lead 360");
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
