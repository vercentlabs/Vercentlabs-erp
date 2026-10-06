import { validateRefundForPosting } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// What stops the refund being posted now (credit left, bank account, period, …).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ check: await validateRefundForPosting(client, context, id) }), "accounting.refund.view");
}
