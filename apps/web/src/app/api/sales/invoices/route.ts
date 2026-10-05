import { listSalesInvoices } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

const FILTER_KEYS = [
  "view", "search", "status", "paymentStatus", "partyId", "salesOrderId", "ownerUserId", "currencyCode", "dateFrom", "dateTo", "dueFrom", "dueTo", "overdue", "sort", "direction", "limit", "offset",
] as const;

// Sales → Invoices: every invoice the caller may see (by its order's visibility, or all for Finance).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return salesRead(request, "sales.invoice.view", async (client, context) => await listSalesInvoices(client, context, filters));
}
