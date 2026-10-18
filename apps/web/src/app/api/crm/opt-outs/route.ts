import { addOptOut, listOptOuts, removeOptOut } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The organization's opt-out list (CRM plan 4.3), for CRM settings and privacy managers.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ optOuts: await listOptOuts(client, crmContext(session, snapshot), { search: new URL(request.url).searchParams.get("search") ?? "" }) }));
}

// Add { email?, phone?, channels?, reason? }.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ optOuts: await addOptOut(client, crmContext(session, snapshot), await readBody(request) as never) }, 201));
}

// Remove { kind, value, personAsked?, reason? } — only after 90 days, or when the person asked.
export async function DELETE(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await removeOptOut(client, crmContext(session, snapshot), await readBody(request) as never)));
}
