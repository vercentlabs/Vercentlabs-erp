import { previewPosCartInvoice } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the GST invoice this bill will become — document type (decided by the rules, never chosen), seller GSTIN, buyer, place of supply,
// lines with HSN and tax, totals by component, e-invoice applicability and anything that would stop it. No number is given by a preview.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ preview: await previewPosCartInvoice(client, context, id) }), "pos.view");
}
