import { getJournalFormOptions } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// What the manual journal form offers: journals, accounts that take manual journals, departments, cost centres, parties, currencies, dimensions.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ options: await getJournalFormOptions(client, context) }));
}
