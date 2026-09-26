import { findCrmDuplicates } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F008 possible-duplicate check, called while composing a new/edited
// lead — never auto-merges; the UI shows candidates and requires an
// explicit authorized decision (see /api/crm/leads/[id]/merge).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const body = (await readJson(request)) as { input: Record<string, unknown>; excludeId?: string | null };
    const duplicates = await findCrmDuplicates(client, crmContext(session), body.input, body.excludeId ?? null);
    return ok({ duplicates });
  });
}
