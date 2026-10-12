import { reconcilePosInvoice } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ invoiceId: string }> };

// GET: do the invoice's lines add up to its header, and the header to the sale? (Read-only.)
export async function GET(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return posRead(request, async (client, context) => ({ reconciliation: await reconcilePosInvoice(client, context, invoiceId) }), "pos.view");
}
