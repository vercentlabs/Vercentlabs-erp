import { listPosRefunds } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?search=&status=&sourceType=&method=&outstanding=true&dateFrom=&dateTo=&limit=&offset=: refunds at the outlets you work at.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const value = (key: string) => search.get(key) || undefined;
  return posRead(request, async (client, context) => listPosRefunds(client, context, {
    search: value("search"), status: value("status"), sourceType: value("sourceType"), sourceId: value("sourceId"), method: value("method"), outstanding: search.get("outstanding") === "true",
    dateFrom: value("dateFrom"), dateTo: value("dateTo"), limit: search.get("limit") ? Number(search.get("limit")) : undefined, offset: search.get("offset") ? Number(search.get("offset")) : undefined,
  }), "pos.view");
}
