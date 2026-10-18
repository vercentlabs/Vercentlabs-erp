import { listCalls, listSmsMessages, listSmsTemplates, sendSms, startCall, type ChannelRecordType } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Calls and SMS on a record (CRM plan 4.4). /api/crm/channels/{leads|opportunities|accounts|contacts}/{id}
type Params = { params: Promise<{ entity: string; id: string }> };
const TYPES: Record<string, ChannelRecordType> = { leads: "lead", opportunities: "opportunity", accounts: "party", contacts: "contact" };

// The record's calls and SMS, and the SMS templates to pick from.
export async function GET(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    return ok({ calls: await listCalls(client, context, TYPES[entity], id), sms: await listSmsMessages(client, context, TYPES[entity], id), templates: await listSmsTemplates(client, context) });
  });
}

// { action: "call" } rings through Exotel; { action: "sms", templateId, values[] } sends an SMS.
export async function POST(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    const context = crmContext(session, snapshot);
    if (body.action === "sms")
      return ok({ result: await sendSms(client, context, TYPES[entity], id, { templateId: String(body.templateId ?? ""), values: Array.isArray(body.values) ? body.values.map(String) : [] }) }, 201);
    return ok({ result: await startCall(client, context, TYPES[entity], id) }, 201);
  });
}
