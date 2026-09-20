import { listSalesPass1Operations } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

const KINDS = ["advances", "adjustments", "drop-ships", "commission-rules", "commissions", "fulfillment-requests", "invoice-requests", "returns"];

// One read endpoint for the operational registers. The kind is checked against a
// fixed list here as well as in the domain, so an arbitrary table name can never
// be reached through this route.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 100);
  return salesRead("sales.view", async (client, context) => {
    if (!KINDS.includes(kind)) return { rows: [], error: "Unknown register." };
    return { rows: await listSalesPass1Operations(client, context, { kind, limit }) };
  });
}
