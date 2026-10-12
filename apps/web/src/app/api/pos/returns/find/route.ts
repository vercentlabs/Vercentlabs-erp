import { findPosSaleForReturn } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?code=&storeId=: a receipt or invoice number, a scanned receipt code or a sale reference → the sale and what can still be returned.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    eligibility: await findPosSaleForReturn(client, context, { code: search.get("code") ?? search.get("receiptNumber") ?? "", storeId: search.get("storeId") ?? undefined }),
  }), "pos.view");
}
