import { getPosSaleInvoice } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the sale's GST invoice (number, lines, taxes, credit notes) — or why it has none (a non-GST receipt, or a sale from before invoices).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => getPosSaleInvoice(client, context, id), "pos.view");
}
