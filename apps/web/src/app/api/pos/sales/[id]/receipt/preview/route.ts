import { previewPosReceipt } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET ?width=58|80|210&version=&copy=1: the sale's finalized document rendered by the server (the browser never computes the receipt) — a
// specific issued version, and as a reprint would print it (copy=1). Changes nothing; looking up another cashier's sale is recorded.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const width = Number(search.get("width") ?? 80);
  const version = search.get("version") ? Number(search.get("version")) : undefined;
  return posRead(request, async (client, context) => ({
    preview: await previewPosReceipt(client, context, "pos_sale", id, { width, version, asCopy: search.get("copy") === "1" }),
  }), "pos.view");
}
