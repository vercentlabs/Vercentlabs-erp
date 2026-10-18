import { getChannelSettings, saveChannelSettings, setMyCallPhone } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Calls and SMS setup (CRM plan 4.4). GET for everyone in CRM (it carries their own call number); PUT { telephony?, sms? } for CRM
// settings managers (the callback keys come back once); PATCH { myCallPhone } for anyone, setting the number their calls ring.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ settings: await getChannelSettings(client, crmContext(session, snapshot)) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await saveChannelSettings(client, crmContext(session, snapshot), await readBody(request))));
}

export async function PATCH(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok(await setMyCallPhone(client, crmContext(session, snapshot), body.myCallPhone ? String(body.myCallPhone) : null));
  });
}
