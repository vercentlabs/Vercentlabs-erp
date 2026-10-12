import { getPosInvoiceEInvoiceStatus } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ invoiceId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return posRead(request, async (client, context) => ({ einvoice: await getPosInvoiceEInvoiceStatus(client, context, invoiceId) }), "pos.view");
}
