import { getOutletHistory, getOutletInventorySummary, getOutletSessions, getOutletTerminals, getOutletTransactions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string; view: string }> };

// The outlet's tabs, each read from its own domain: inventory (Inventory's balances), terminals, sessions (?status), transactions (?search),
// history.
export async function GET(request: Request, { params }: Params) {
  const { outletId, view } = await params;
  const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => {
    switch (view) {
      case "inventory": return { inventory: await getOutletInventorySummary(client, context, outletId) };
      case "terminals": return { rows: await getOutletTerminals(client, context, outletId) };
      case "sessions": return { rows: await getOutletSessions(client, context, outletId, filters) };
      case "transactions": return { rows: await getOutletTransactions(client, context, outletId, filters) };
      case "history": return { rows: await getOutletHistory(client, context, outletId) };
      default: throw new HttpError(404, "Unknown outlet view.");
    }
  });
}
