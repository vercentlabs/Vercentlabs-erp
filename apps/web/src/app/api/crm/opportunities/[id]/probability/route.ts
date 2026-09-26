import { updateOpportunityProbability } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F011. A manual override is distinct from the stage-configured default —
// updateOpportunityProbability's own history table is the authority for
// that distinction, not this route. It does not check a permission
// internally, so this route enforces crm.opportunities.manage itself.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      probability: number;
      note?: string | null;
      expectedUpdatedAt?: string;
      expectedProbability?: number | null;
    };
    const record = await updateOpportunityProbability(client, crmContext(session), id, body.probability, body.note ?? null, {
      expectedUpdatedAt: body.expectedUpdatedAt,
      expectedProbability: body.expectedProbability,
    });
    return ok({ record });
  });
}
