import { createCloseReason, listCloseReasons } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// The won and lost reasons: ?outcome=won|lost&includeInactive=1
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) => {
    const url = new URL(request.url);
    const outcome = url.searchParams.get("outcome");
    return ok({ reasons: await listCloseReasons(client, crmContext(session), {
      outcome: outcome === "won" || outcome === "lost" ? outcome : undefined, includeInactive: url.searchParams.get("includeInactive") === "1",
    }) });
  });
}

// Body: { outcome, name, category?, requiresNotes?, capturesCompetitor?, requiresCompetitor?, offersFollowUp?, linksDuplicate? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManageCloseReasons, billingWrite: true }, async ({ client, session }) =>
    ok({ reason: await createCloseReason(client, crmContext(session), await readBody(request)) }, 201),
  );
}
