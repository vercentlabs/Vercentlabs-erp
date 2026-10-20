import { getFinanceHome } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The Finance home: cash, receivables, payables, this month's results, and what needs attention.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ home: await getFinanceHome(client, context) }));
}
