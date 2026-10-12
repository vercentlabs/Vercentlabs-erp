import { listPosReceiptPrintHistory } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: every print of the sale's document — who, when, original or copy, how it ended.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ history: await listPosReceiptPrintHistory(client, context, "pos_sale", id) }), "pos.view");
}
