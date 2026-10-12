import { getPosReturn } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the return's documents — its return receipt (print / reprint under /receipt) and the credit note when the sale had a tax invoice.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => {
    const posReturn = await getPosReturn(client, context, id);
    return { documents: { returnNumber: posReturn.returnNumber, receipt: posReturn.status === "POSTED" ? `/api/pos/returns/${id}/receipt` : null,
      creditNote: posReturn.creditNoteId ? { id: posReturn.creditNoteId, number: posReturn.creditNoteNumber, document: `/api/pos/invoices/${posReturn.creditNoteId}/document` } : null } };
  }, "pos.view");
}
