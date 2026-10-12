import { listPosPaymentExceptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Payment exceptions (?status=open|refund_requested|refunded|resolved): credits that could not simply be applied — short, excess,
// duplicate, late, unmatched, wrong merchant / currency, conflicting — waiting for Finance or a manager.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    exceptions: await listPosPaymentExceptions(client, context, { status: url.searchParams.get("status") ?? undefined }),
  }), "pos.view");
}
