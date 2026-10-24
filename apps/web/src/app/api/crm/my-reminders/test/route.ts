import { sendTestReminder } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Sends the caller a test reminder on the WhatsApp or SMS they chose: { whatsapp?, sms? } each "sent" or why not.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ result: await sendTestReminder(client, crmContext(session, snapshot)) }));
}
