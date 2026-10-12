import { listPosRefundExceptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?status=open|resolved|all: refund reconciliation exceptions — unknown outcomes, provider failures, amount mismatches, duplicate payouts.
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return posRead(request, async (client, context) => ({ exceptions: await listPosRefundExceptions(client, context, { status }) }), "pos.view");
}
