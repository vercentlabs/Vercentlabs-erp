import { getShiftOpeningSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=: shift openings — open shifts by outlet, active counters, floats, cash vs card / UPI shifts, variances, approvals, long-open
// shifts, refused openings and handovers waiting.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getShiftOpeningSummary(client, context, { from: search.get("from"), to: search.get("to") }),
  }), "pos.view");
}
