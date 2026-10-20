import { getReceiptFormOptions } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The receipt form's choices; with ?partyId, that customer's open invoices and the advance it already holds.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["partyId", "currencyCode"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ options: await getReceiptFormOptions(client, context, filters) }));
}
