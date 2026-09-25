import { assertSameOriginOrMobile, findAccountDuplicates, projectDuplicateMatchesForCaller } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F002 Tranche E (Stage A). findAccountDuplicates (duplicate-matching.js)
// already existed, already tested, already used internally by lead
// conversion's own duplicate check — but never reachable from a plain
// GET/POST an Account-360 user could hit. Read-only, module-access-only,
// same convention as /api/crm/leads/duplicates.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { input?: Record<string, unknown> };
    const duplicates = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      const context = crmContext(session);
      return projectDuplicateMatchesForCaller(context, "account", await findAccountDuplicates(client, context, body.input ?? {}));
    });
    return ok({ duplicates });
  } catch (error) {
    return errorResponse(error);
  }
}
