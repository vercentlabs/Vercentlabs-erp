import { assertSameOriginOrMobile, transitionLeadStage } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// Lead pipeline-status transitions (F007) are a distinct axis from
// qualification (F006) and record status — this route only ever moves
// crm_leads.status along the governed transition graph, never bundles a
// qualification decision into the same call.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, (client) =>
      transitionLeadStage(client, crmContext(session), id, input),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
