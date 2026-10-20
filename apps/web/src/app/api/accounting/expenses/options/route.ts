import { getExpenseFormOptions } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// What the expense form offers: categories, cash and bank accounts, suppliers, people, departments and cost centres.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ options: await getExpenseFormOptions(client, context) }));
}
