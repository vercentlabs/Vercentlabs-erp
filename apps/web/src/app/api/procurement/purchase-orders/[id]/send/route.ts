import { renderAuthorizedDocument, sendPurchaseOrder } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Emails the current confirmed version as a PDF (built from its snapshot). The request key makes a retry send nothing twice.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input, session) => {
    const pdf = await renderAuthorizedDocument(client, session, "procurement.purchase_order", id);
    return { result: await sendPurchaseOrder(client, context, id, input, { fileName: pdf.fileName, content: pdf.body }) };
  }, 200, "procurement.po.send");
}
