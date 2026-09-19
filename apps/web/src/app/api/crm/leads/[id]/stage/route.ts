import { assertSameOriginOrMobile, getLeadStageDwell, listLeadStageHistory, transitionLeadStage } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F007 dwell/SLA context + transition history for the "Move to stage…"
// panel — dwell is derived server-side from stage_entered_at, never
// computed client-side from updated_at.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const ctx = crmContext(session);
    // Sequential, not Promise.all — concurrent queries on one shared
    // pg client/connection are unsafe (see opportunity-revenue-
    // intelligence.js's documented fix for the same hazard).
    const { dwell, history } = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      const dwell = await getLeadStageDwell(client, ctx, id);
      const history = await listLeadStageHistory(client, ctx, id);
      return { dwell, history };
    });
    return ok({ dwell, history });
  } catch (error) {
    return errorResponse(error);
  }
}

// Lead pipeline-status transitions (F007) are a distinct axis from
// qualification (F006) and record status — this route only ever moves
// crm_leads.status along the governed transition graph, never bundles a
// qualification decision into the same call. transitionLeadStage does not
// check a permission internally (unlike assignLeadOwner/decideLeadQualification),
// so this route enforces crm.leads.manage itself.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage, { mutation: true });
      return transitionLeadStage(client, crmContext(session), id, input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
