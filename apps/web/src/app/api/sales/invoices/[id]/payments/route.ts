import { z } from "zod";

import { recordInvoicePayment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Records a customer's payment on the invoice (Sales audit B7): the receipt is posted to the chosen account and applied to the invoice.
// The operation checks "record payments" (or Accounting's receipts permission) itself.
const schema = z.object({
  amount: z.number().positive(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMethod: z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]).optional(),
  reference: z.string().max(200).optional(),
  bankAccountId: z.string().uuid().nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.view", schema, async (client, context, input) => ({ result: await recordInvoicePayment(client, context, id, input) }));
}
