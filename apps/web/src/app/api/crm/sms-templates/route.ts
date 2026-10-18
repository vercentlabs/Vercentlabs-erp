import { listSmsTemplates, saveSmsTemplate } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// DLT SMS templates (?all=1 includes those switched off, for CRM settings managers).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ templates: await listSmsTemplates(client, crmContext(session, snapshot), { includeInactive: new URL(request.url).searchParams.get("all") === "1" }) }));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ templates: await saveSmsTemplate(client, crmContext(session, snapshot), null, await readBody(request)) }, 201));
}
