import { findContactDuplicates } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F003 Tranche F (Stage A). findContactDuplicates (duplicate-matching.js)
// already existed, already tested, with zero frontend wiring. Mirrors
// /api/crm/accounts/duplicates exactly.
export async function POST(request: Request) {
  try {
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { input?: Record<string, unknown> };
    const duplicates = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return findContactDuplicates(client, crmContext(session), body.input ?? {});
    });
    return ok({ duplicates });
  } catch (error) {
    return errorResponse(error);
  }
}
