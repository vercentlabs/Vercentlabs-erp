import { getLeadScoring, saveLeadScoringSettings } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Lead scoring (CRM plan 5.3): the rules, the settings, what can be scored on, and how much history there is.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok(await getLeadScoring(client, crmContext(session, snapshot))));
}

// Body: any of { useHistory, minimumHistory, hotThreshold } — open leads are scored again.
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await saveLeadScoringSettings(client, crmContext(session, snapshot), await readBody(request))));
}
