import { z } from "zod";

import { renderAuthorizedDocument } from "@vercentlabs/api";
import { emailDealQuote } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Emails the quote to the customer with its PDF, rendered by the shared document renderer.
const schema = z.object({
  to: z.string().max(320),
  cc: z.string().max(1000).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().max(10000).optional(),
});

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session, snapshot }) => {
    const input = schema.parse(await readJson(request));
    const pdf = await renderAuthorizedDocument(client, session, "crm.quote", id);
    return ok({ result: await emailDealQuote(client, crmContext(session, snapshot), id, input, { fileName: pdf.fileName, content: pdf.body }, process.env) });
  });
}
