import { listSalesPayments } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Payments received: ?search=&from=&to=&limit=&offset= (Line-by-line audit).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const read = (name: string) => url.searchParams.get(name) ?? undefined;
  return salesRead(request, "sales.invoice.payments.view", async (client, context) =>
    listSalesPayments(client, context, { search: read("search"), from: read("from"), to: read("to"), limit: Number(read("limit") ?? 25), offset: Number(read("offset") ?? 0) }));
}
