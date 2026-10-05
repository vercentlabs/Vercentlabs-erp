import { z } from "zod";

import { renderAuthorizedDocument, sendSalesInvoice } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";

// Emails the posted invoice with its PDF (built from the invoice's snapshots). The request key makes a retry send nothing twice.
const schema = z.object({
  to: z.string().max(320),
  cc: z.string().max(1000).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().max(10000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "sales", permission: "sales.invoice.send", billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    const pdf = await renderAuthorizedDocument(client, session, "sales.invoice", id);
    return ok({ result: await sendSalesInvoice(client, salesContext(session), id, input, { fileName: pdf.fileName, content: pdf.body }) });
  });
}
