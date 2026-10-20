import { listReceivableInvoices } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Invoices and credit notes as Finance sees them: what is still owed, how late, and the Sales document behind each.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["view", "partyId", "search"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ invoices: await listReceivableInvoices(client, context, filters) }));
}
