import { decideLeadQualification, getLeadQualification } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F006 qualification is a fully governed, independent axis from pipeline
// stage (F007) and record status — decideLeadQualification (lead-
// qualification.js) owns readiness criteria, override policy and history;
// this route never re-derives any of that. decideLeadQualification already
// checks crm.leads.manage internally (assertCanDecide); this route still
// enforces the module-access layer for both GET and POST.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const qualification = await getLeadQualification(client, crmContext(session), id);
    return ok({ qualification });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await decideLeadQualification(client, crmContext(session), id, input);
    return ok(result);
  });
}
