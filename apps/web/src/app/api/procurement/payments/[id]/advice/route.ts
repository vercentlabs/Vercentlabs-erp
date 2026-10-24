import { getSupplierPayment, paymentAdviceSends, renderAuthorizedDocument, sendPaymentAdvice } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The payment advice: GET what was sent, to whom, and the WhatsApp link; POST { to?, cc? } emails it now with its PDF.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ advice: await paymentAdviceSends(client, context, await getSupplierPayment(client, context, id)) }), "procurement.bills.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input, session) => {
    const detail = await getSupplierPayment(client, context, id);
    const pdf = await renderAuthorizedDocument(client, session, "procurement.payment_advice", id);
    const body = input as { to?: string; cc?: string };
    return { result: await sendPaymentAdvice(client, context, detail, { to: body.to, cc: body.cc }, { fileName: pdf.fileName, content: pdf.body }) };
  }, 200, "procurement.bills.view");
}
