import { listCreditNotes } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

const FILTER_KEYS = [
  "view", "search", "status", "partyId", "reasonCode", "salesOrderId", "invoiceId", "returnId", "fromReturn", "unapplied", "dateFrom", "dateTo", "sort", "direction", "limit", "offset",
] as const;

// Sales → Credit Notes: every credit note the caller may see (by its order's visibility, or all for Finance).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return salesRead(request, "sales.credit_note.view", async (client, context) => await listCreditNotes(client, context, filters));
}
