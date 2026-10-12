import { z } from "zod";

import { reverseFundTransfer } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

export async function POST(request: Request, ctx: { params: Promise<{ transferId: string }> }) {
  const { transferId } = await ctx.params;
  return accountingMutation(request, z.object({ reason: z.string().trim().min(1).max(500) }), async (client, context, input) => ({ transfer: await reverseFundTransfer(client, context, transferId, input) }),
    200, "accounting.bank.manage");
}
