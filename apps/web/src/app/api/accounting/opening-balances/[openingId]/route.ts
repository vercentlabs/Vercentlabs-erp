import { getOpeningBalances } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ openingId: string }> }) {
  const { openingId } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ openingBalances: await getOpeningBalances(client, context, openingId) }));
}
