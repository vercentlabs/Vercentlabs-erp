import { listTeamMembers } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmView, assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

type Params = { params: Promise<{ teamId: string }> };

// F015 Tasks workspace — powers the "assign to a specific Team member"
// picker when creating/editing a queued Task.
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { teamId } = await params;
    assertCrmIdentifier(teamId);
    const context = await crmApiContext(session);
    const members = await tenantTransaction(context.organizationId, (client) => listTeamMembers(client, context, teamId));
    return ok({ members });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
