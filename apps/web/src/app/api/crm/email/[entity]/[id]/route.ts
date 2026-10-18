import { prepareRecordEmail, sendRecordEmail, type CrmEmailRecordType } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Email from a record (CRM plan 4.1). /api/crm/email/{leads|opportunities|accounts|contacts}/{id}
type Params = { params: Promise<{ entity: string; id: string }> };
const TYPES: Record<string, CrmEmailRecordType> = { leads: "lead", opportunities: "opportunity", accounts: "party", contacts: "contact" };

// The email as the composer starts it (?templateId= fills a template).
export async function GET(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ draft: await prepareRecordEmail(client, crmContext(session, snapshot), TYPES[entity], id, { templateId: new URL(request.url).searchParams.get("templateId") }) }));
}

// Send { to, cc?, subject, body, templateId?, replyToEmailId? }.
export async function POST(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ email: await sendRecordEmail(client, crmContext(session, snapshot), TYPES[entity], id, await readBody(request)) }, 201));
}
