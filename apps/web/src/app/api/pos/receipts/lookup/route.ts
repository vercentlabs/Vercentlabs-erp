import { resolvePosReceiptFromCode } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?code=POSR…: the sale (or return) a scanned receipt reference belongs to (TRANSACTION_LOOKUP at that outlet).
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  return posRead(request, async (client, context) => ({ match: await resolvePosReceiptFromCode(client, context, code) }), "pos.view");
}
