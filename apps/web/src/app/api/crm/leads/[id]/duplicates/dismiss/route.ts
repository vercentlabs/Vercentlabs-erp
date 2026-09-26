import { dismissLeadDuplicateMatch } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F008: dismissing a probable-duplicate signal is reasoned and audited,
// never a silent client-side hide — an exact duplicate cannot be
// dismissed at all (dismissLeadDuplicateMatch enforces that itself).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { matchedLeadId: string; reason: string };
    const result = await dismissLeadDuplicateMatch(client, crmContext(session), id, body.matchedLeadId, body.reason);
    return ok({ result });
  });
}
