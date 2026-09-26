import { restoreOpportunity } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F009 gap-closure — every competitor in the benchmark report treats a
// closed deal as reversible; Archived opportunities were Vercentlabs's one
// true dead end. restoreOpportunity does not check a permission internally
// (matching moveOpportunityStage's own contract), so this route enforces
// crm.opportunities.manage itself — the same permission archiving the
// record in the first place already requires.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { reason: string; expectedUpdatedAt?: string };
    const record = await restoreOpportunity(client, crmContext(session), id, body.reason, {
      expectedUpdatedAt: body.expectedUpdatedAt,
    });
    return ok({ record });
  });
}
