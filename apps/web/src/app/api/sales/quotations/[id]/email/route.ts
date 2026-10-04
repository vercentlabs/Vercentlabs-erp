import { z } from "zod";

import { emailQuotation, renderAuthorizedDocument } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";

// Emails the quotation to the customer with its PDF, rendered by the shared document renderer.
const schema = z.object({
  to: z.string().max(320),
  cc: z.string().max(1000).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().max(10000).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "sales", permission: "sales.quotation.send", billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    const pdf = await renderAuthorizedDocument(client, session, "sales.quotation", id);
    return ok({ result: await emailQuotation(client, salesContext(session), id, input, { fileName: pdf.fileName, content: pdf.body }) });
  });
}
