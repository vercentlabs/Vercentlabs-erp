import { listPosShiftOpenings } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=&storeId=&terminalId=&cashierUserId=&status=&limit=&offset=: shift openings — who, counter, cash or card / UPI, float, handover,
// variance and approval. A cashier without wider rights sees their own.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const value = (name: string) => search.get(name) || undefined;
  return posRead(request, async (client, context) => listPosShiftOpenings(client, context, {
    from: value("from"), to: value("to"), storeId: value("storeId"), terminalId: value("terminalId"), cashierUserId: value("cashierUserId"), status: value("status"),
    limit: value("limit") ? Number(value("limit")) : undefined, offset: value("offset") ? Number(value("offset")) : undefined,
  }), "pos.view");
}
