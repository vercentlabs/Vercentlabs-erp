import { logClickToChat, prepareWhatsApp, sendWhatsApp, type WhatsAppRecordType } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// WhatsApp from a record (CRM plan 4.2). /api/crm/whatsapp/{leads|opportunities|accounts|contacts}/{id}
type Params = { params: Promise<{ entity: string; id: string }> };
const TYPES: Record<string, WhatsAppRecordType> = { leads: "lead", opportunities: "opportunity", accounts: "party", contacts: "contact" };

export async function GET(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ draft: await prepareWhatsApp(client, crmContext(session, snapshot), TYPES[entity], id) }));
}

// { via: "click_to_chat", body, phone? } logs it and returns the wa.me link; { via: "cloud_api", body | templateName, templateLanguage, parameters } sends it.
export async function POST(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    const context = crmContext(session, snapshot);
    if (body.via === "cloud_api") return ok({ result: await sendWhatsApp(client, context, TYPES[entity], id, body) }, 201);
    return ok({ result: await logClickToChat(client, context, TYPES[entity], id, body) }, 201);
  });
}
