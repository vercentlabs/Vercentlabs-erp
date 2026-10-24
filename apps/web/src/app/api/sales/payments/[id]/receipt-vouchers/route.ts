import { z } from "zod";

import { issueReceiptVoucher, listReceiptVouchers } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The payment's receipt vouchers for advances (GST Rule 50), with what was used and refunded.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => {
    const from = (await client.query("SELECT receipt_vouchers_from::text AS from_day FROM tenant.sales_settings WHERE organization_id = $1", [context.organizationId])).rows[0]?.from_day ?? null;
    return { ...(await listReceiptVouchers(client, context, { receiptId: id })), vouchersFrom: from };
  });
}

// Issues a receipt voucher for the payment's advance: { rate, amount?, description?, sacHsn?, voucherDate? }.
const schema = z.object({
  rate: z.number().min(0).max(40), amount: z.number().positive().optional(), description: z.string().trim().max(500).optional(), sacHsn: z.string().trim().max(10).optional(),
  voucherDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => issueReceiptVoucher(client, context, { ...input, receiptId: id }), 201);
}
