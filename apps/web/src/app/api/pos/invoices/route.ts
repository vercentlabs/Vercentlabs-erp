import { listPosInvoices } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?search=&documentType=&supplyType=&dateFrom=&dateTo=&limit=&offset=: POS invoices and credit notes at the outlets you work at —
// an exact invoice number (or buyer GSTIN) first, then numbers starting with it.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const value = (key: string) => search.get(key) || undefined;
  return posRead(request, async (client, context) => listPosInvoices(client, context, {
    search: value("search"), documentType: value("documentType"), supplyType: value("supplyType") as "b2b" | "b2c" | undefined, dateFrom: value("dateFrom"), dateTo: value("dateTo"),
    limit: search.get("limit") ? Number(search.get("limit")) : undefined, offset: search.get("offset") ? Number(search.get("offset")) : undefined,
  }), "pos.view");
}
