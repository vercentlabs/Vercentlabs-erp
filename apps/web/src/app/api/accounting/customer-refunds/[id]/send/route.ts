import { z } from "zod";

import { renderAuthorizedDocument, sendRefundConfirmation } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";

// Emails the refund voucher of a posted refund. The request key makes a retry send nothing twice.
const schema = z.object({
  to: z.string().max(320),
  cc: z.string().max(1000).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().max(10000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "accounting", permission: "accounting.refund.send", billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    const pdf = await renderAuthorizedDocument(client, session, "accounting.customer_refund", id);
    return ok({ result: await sendRefundConfirmation(client, accountingContext(session), id, input, { fileName: pdf.fileName, content: pdf.body }) });
  });
}
