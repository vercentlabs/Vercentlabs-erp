import { getExpense } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ expenseId: string }> }) {
  const { expenseId } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ expense: await getExpense(client, context, expenseId) }));
}
