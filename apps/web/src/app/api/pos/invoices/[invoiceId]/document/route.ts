import { getPosInvoice, previewPosReceipt } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ invoiceId: string }> };

// GET ?width=58|80|210: the invoice's authoritative document (A4 for the full GST invoice), from the finalized snapshot — never recalculated.
export async function GET(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  const width = Number(new URL(request.url).searchParams.get("width") ?? 210);
  return posRead(request, async (client, context) => {
    const invoice = await getPosInvoice(client, context, invoiceId);
    return { document: await previewPosReceipt(client, context, invoice.sourceType, invoice.sourceId, { width }) };
  }, "pos.view");
}
