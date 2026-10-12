import { listPosInventoryChanges } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?after=&outletId=&terminalId=: availability-changed events after a cursor for the warehouses this user's outlets use (the live stream's
// polling fallback). Without `after` it returns the current cursor to start from.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    changes: await listPosInventoryChanges(client, context, { after: search.get("after"), outletId: search.get("outletId"), terminalId: search.get("terminalId") }),
  }), "pos.view");
}
