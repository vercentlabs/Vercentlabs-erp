import { listSalesEwayBills } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Dispatch › E-way Bills (Sales plan): the e-way bills of invoices, deliveries and challans. ?status=generated|cancelled|failed|expiring&search=&limit=&offset=.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const read = (name: string) => url.searchParams.get(name) ?? undefined;
  return workspaceRoute(request, { module: "sales", permission: "sales.view" }, async ({ client, session }) =>
    ok(await listSalesEwayBills(client, session, { status: read("status"), search: read("search"), limit: Number(read("limit") ?? 25), offset: Number(read("offset") ?? 0) })));
}
