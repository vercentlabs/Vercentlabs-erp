import { checkTelephony, sendTestSms } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Checks the setup: { kind: "calls" } asks Exotel for the account; { kind: "sms", templateId, phone? } sends a test SMS.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const body = (await readBody(request)) as { kind?: string; templateId?: string; phone?: string };
    if (body.kind === "sms") return ok({ result: await sendTestSms(client, context, { templateId: body.templateId, phone: body.phone ?? null }) });
    return ok({ result: await checkTelephony(client, context) });
  });
}
