import { getReconciliationOverview } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: the dashboard — paid, provider-matched, awaiting provider, awaiting settlement, settled, awaiting bank, bank received; open exceptions by type and age.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => ({ overview: await getReconciliationOverview(client, context, params) }), "pos.view");
}
