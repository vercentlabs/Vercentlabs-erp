import { listShiftClosingExceptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: what closings handed on (?status=open|all, shiftId, queue).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => ({ exceptions: await listShiftClosingExceptions(client, context, params) }), "pos.view");
}
