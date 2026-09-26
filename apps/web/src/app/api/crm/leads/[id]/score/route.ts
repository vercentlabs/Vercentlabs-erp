import { getLeadScoreExplanation, recalculateLeadScore } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F027 scoring is read-only intelligence — it must never be treated as
// lifecycle authority. Recalculation only re-derives score/grade from the
// active model; it can never change status/qualificationStatus/recordStatus.
// Both functions already check crm.leads.view_sensitive internally
// (assertSensitiveLeadIntelligenceAccess); this route still enforces the
// module-access layer.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const explanation = await getLeadScoreExplanation(client, crmContext(session), id);
    return ok({ explanation });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as { reason?: string };
    const result = await recalculateLeadScore(client, crmContext(session), id, input.reason || "Manual recalculation from Lead 360");
    return ok(result);
  });
}
