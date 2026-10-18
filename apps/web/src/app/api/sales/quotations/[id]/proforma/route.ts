import { z } from "zod";

import { emailProformaInvoice, renderAuthorizedDocument } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";

// Emails the quotation's proforma invoice (CRM plan 4.7) with its PDF. The PDF itself is /api/documents/sales.proforma/{id}/pdf?advance=.
const schema = z.object({
  to: z.string().max(320),
  cc: z.string().max(1000).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().max(10000).optional(),
  advancePercent: z.number().min(0).max(100).nullable().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "sales", permission: "sales.quotation.send", billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    const advancePercent = input.advancePercent || null;
    const pdf = await renderAuthorizedDocument(client, session, "sales.proforma", id, { advancePercent });
    return ok({ result: await emailProformaInvoice(client, salesContext(session), id, { ...input, advancePercent }, { fileName: pdf.fileName, content: pdf.body }) });
  });
}
