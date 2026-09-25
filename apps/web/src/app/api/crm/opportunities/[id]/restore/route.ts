import { assertSameOriginOrMobile, restoreOpportunity } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F009 gap-closure — every competitor in the benchmark report treats a
// closed deal as reversible; Archived opportunities were Vercentlabs's one
// true dead end. restoreOpportunity does not check a permission internally
// (matching moveOpportunityStage's own contract), so this route enforces
// crm.opportunities.manage itself — the same permission archiving the
// record in the first place already requires.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { reason: string; expectedUpdatedAt?: string };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return restoreOpportunity(client, crmContext(session), id, body.reason, {
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
