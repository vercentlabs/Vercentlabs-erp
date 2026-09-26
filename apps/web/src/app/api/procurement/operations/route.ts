import { listProcurementPass1Operations } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

const KINDS = ["supplier-prices", "landed-costs", "supplier-lead-times", "reorder-requests", "subcontract-orders", "invoice-matches"];

// Read endpoint for the operational registers; the kind is checked against a fixed
// list here as well as in the domain, so a table name can never be chosen by the caller.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 100);
  return procurementRead(request, async (client, context) => {
    if (!KINDS.includes(kind)) return { rows: [], error: "Unknown register." };
    return { rows: await listProcurementPass1Operations(client, context, { kind, limit }) };
  });
}
