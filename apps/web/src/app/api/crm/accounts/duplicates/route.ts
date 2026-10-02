import {
  findAccountDuplicates,
  projectDuplicateMatchesForCaller,
} from "@vercentlabs/api/crm";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F002. findAccountDuplicates (duplicate-matching.js), also used by lead
// conversion's own duplicate check, for the Account 360. Read-only, module-access-only,
// same convention as /api/crm/leads/duplicates.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const body = (await readJson(request)) as {
        input?: Record<string, unknown>;
      };
      const context = crmContext(session);
      const duplicates = await projectDuplicateMatchesForCaller(
        context,
        "account",
        await findAccountDuplicates(client, context, body.input ?? {}),
      );
      return ok({ duplicates });
    },
  );
}
