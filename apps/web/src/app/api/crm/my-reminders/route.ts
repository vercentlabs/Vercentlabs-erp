import { getMyReminderChannels, getReminderTemplates, saveMyReminderChannels, saveReminderTemplates } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Reminders on WhatsApp and SMS (CRM audit M6). GET: the caller's choice and the company's templates. PATCH { whatsapp?, sms?, mobile? }:
// the caller's own choice. PUT { whatsappTemplate?, whatsappLanguage?, smsTemplateId? }: the company's templates (CRM settings managers).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    return ok({ mine: await getMyReminderChannels(client, context), templates: await getReminderTemplates(client, context) });
  });
}

export async function PATCH(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ mine: await saveMyReminderChannels(client, crmContext(session, snapshot), await readBody(request)) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ templates: await saveReminderTemplates(client, crmContext(session, snapshot), await readBody(request)) }));
}
