import { listPayableBills } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Supplier bills and credits as Finance sees them: what is still owed, when it falls due, and what is already in a payment.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["view", "partyId", "search"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ bills: await listPayableBills(client, context, filters) }));
}
