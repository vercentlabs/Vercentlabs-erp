import { listDebitNotes } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Debit notes to customers (Sales plan): ?search=&status=draft|posted|cancelled&sourceInvoiceId=&limit=&offset=.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const read = (name: string) => url.searchParams.get(name) ?? undefined;
  return salesRead(request, "sales.view", async (client, context) =>
    listDebitNotes(client, context, { search: read("search"), status: read("status"), sourceInvoiceId: read("sourceInvoiceId"), limit: Number(read("limit") ?? 25), offset: Number(read("offset") ?? 0) }));
}
