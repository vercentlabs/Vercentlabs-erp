import { searchSalesOptions } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Search-as-you-type for the document pickers (Sales audit B4): ?kind=customers|products&q=&prospects=0|1
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "products" ? "products" : "customers";
  return salesRead(request, "sales.view", async (client, context) => ({
    results: await searchSalesOptions(client, context, { kind, q: url.searchParams.get("q") ?? "", prospects: url.searchParams.get("prospects") !== "0" }),
  }));
}
