import { z } from "zod";

import { einvoiceAfterPost, finaliseInvoicesInBulk, renderAuthorizedDocument, sendInvoicesInBulk } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

// Many invoices at once (Sales report H2): finalise the chosen drafts (each with its IRN when "e-invoice on finalising" is on), or email
// the chosen final invoices with their PDFs. Each invoice is its own step: one that cannot be done is reported, the others still are.
// Each step checks its own permission (finalise or send).
const schema = z.object({
  action: z.enum(["finalise", "send"]),
  invoiceIds: z.array(z.string().uuid()).min(1).max(100),
  idempotencyKey: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.view", billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    const context = salesContext(session);
    const result = input.action === "finalise"
      ? await finaliseInvoicesInBulk(client, context, input, { afterFinal: (invoiceId) => einvoiceAfterPost(client, context, invoiceId) })
      : await sendInvoicesInBulk(client, context, input, {
        renderPdf: async (invoiceId) => {
          const pdf = await renderAuthorizedDocument(client, session, "sales.invoice", invoiceId);
          return { fileName: pdf.fileName, content: pdf.body };
        },
      });
    return ok(toWire(result) as Record<string, unknown>);
  });
}
