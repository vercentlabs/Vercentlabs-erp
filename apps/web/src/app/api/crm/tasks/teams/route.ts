import { listMyTaskTeams } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

// F015 Tasks workspace: the Team/Queue picker needs the caller's own
// authorized Teams (every Team for a manager/view-all holder, otherwise
// only Teams they actively belong to) — kept as its own small route rather
// than folded into the large shared getCrmOptions() query (see that
// function's own comment on why every option list shares one bound
// parameter array; adding an unrelated shape there risks the exact
// bind-count regression already documented on that function).
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const context = await crmApiContext(session);
    const teams = await tenantTransaction(context.organizationId, (client) => listMyTaskTeams(client, context));
    return ok({ teams });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
