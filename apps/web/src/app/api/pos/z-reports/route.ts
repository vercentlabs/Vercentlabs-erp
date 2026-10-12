import { listZReports } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: Z reports, newest first (?storeId, from, to, q, limit, offset).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => listZReports(client, context, params), "pos.view");
}
