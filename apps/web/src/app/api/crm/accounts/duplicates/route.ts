import { findAccountDuplicates } from "@vercentlabs/api";

import { withClient } from "@/core/db";
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
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { input?: Record<string, unknown> };
    const duplicates = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return findAccountDuplicates(client, crmContext(session), body.input ?? {});
    });
    return ok({ duplicates });
  } catch (error) {
    return errorResponse(error);
  }
}
