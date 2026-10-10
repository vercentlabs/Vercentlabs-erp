import { listPointOfSaleResource } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// The terminals a POS screen picks from (checkout, shifts, reports), filtered to the outlets the person may work at. Terminals themselves
// are maintained under /api/pos/terminals.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const number = (key: string) => (url.searchParams.get(key) ? Number(url.searchParams.get(key)) : undefined);
  return posRead(request, async (client, context) => ({
    rows: await listPointOfSaleResource(client, context, "terminals", { limit: number("limit"), offset: number("offset") }),
  }), "pos.view");
}
