import { getCashDifferenceSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: shortages and overages (apart), discrepant shifts, by outlet, cashier and context, approvals, unresolved cases, recounts, Finance pending.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => ({ summary: await getCashDifferenceSummary(client, context, params) }), "pos.view");
}
