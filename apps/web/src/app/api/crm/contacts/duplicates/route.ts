import { assertSameOriginOrMobile, findContactDuplicates, projectDuplicateMatchesForCaller } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F003 Tranche F (Stage A). findContactDuplicates (duplicate-matching.js)
// already existed, already tested, with zero frontend wiring. Mirrors
// /api/crm/accounts/duplicates exactly.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { input?: Record<string, unknown> };
    const duplicates = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      const context = crmContext(session);
      return projectDuplicateMatchesForCaller(context, "contact", await findContactDuplicates(client, context, body.input ?? {}));
    });
    return ok({ duplicates });
  } catch (error) {
    return errorResponse(error);
  }
}
