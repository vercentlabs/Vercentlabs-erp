import { assertSameOriginOrMobile, updateOpportunityProbability } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F011. A manual override is distinct from the stage-configured default —
// updateOpportunityProbability's own history table is the authority for
// that distinction, not this route. It does not check a permission
// internally, so this route enforces crm.opportunities.manage itself.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      probability: number;
      note?: string | null;
      expectedUpdatedAt?: string;
      expectedProbability?: number | null;
    };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return updateOpportunityProbability(client, crmContext(session), id, body.probability, body.note ?? null, {
        expectedUpdatedAt: body.expectedUpdatedAt,
        expectedProbability: body.expectedProbability,
      });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
