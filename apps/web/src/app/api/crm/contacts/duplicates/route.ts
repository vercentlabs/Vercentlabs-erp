import {
  findContactDuplicates,
  projectDuplicateMatchesForCaller,
} from "@vercentlabs/api/crm";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F003. findContactDuplicates (duplicate-matching.js). Mirrors
// /api/crm/accounts/duplicates exactly.
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
        "contact",
        await findContactDuplicates(client, context, body.input ?? {}),
      );
      return ok({ duplicates });
    },
  );
}
