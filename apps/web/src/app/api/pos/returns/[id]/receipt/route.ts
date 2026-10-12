import { previewPosReceipt } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET ?width=: the return's own finalized receipt (it references the original sale; the sale's receipt is never rewritten by a return).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const width = Number(new URL(request.url).searchParams.get("width") ?? 80);
  return posRead(request, async (client, context) => ({ receipt: await previewPosReceipt(client, context, "pos_return", id, { width }) }), "pos.view");
}
