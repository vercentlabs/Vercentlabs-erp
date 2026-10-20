import { getAccountLedger } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// An account's ledger with its running balance.
export async function GET(request: Request, ctx: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await ctx.params;
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["from", "to", "departmentId", "costCenterId"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ ledger: await getAccountLedger(client, context, accountId, filters) }));
}
