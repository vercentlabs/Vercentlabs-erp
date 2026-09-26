import { findAccountDuplicates, projectDuplicateMatchesForCaller } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F002 Tranche E (Stage A). findAccountDuplicates (duplicate-matching.js)
// already existed, already tested, already used internally by lead
// conversion's own duplicate check — but never reachable from a plain
// GET/POST an Account-360 user could hit. Read-only, module-access-only,
// same convention as /api/crm/leads/duplicates.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const body = (await readJson(request)) as { input?: Record<string, unknown> };
    const context = crmContext(session);
    const duplicates = await projectDuplicateMatchesForCaller(context, "account", await findAccountDuplicates(client, context, body.input ?? {}));
    return ok({ duplicates });
  });
}
