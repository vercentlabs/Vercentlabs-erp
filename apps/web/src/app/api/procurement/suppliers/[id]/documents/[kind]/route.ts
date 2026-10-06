import { listSupplierDocuments } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

type Params = { params: Promise<{ id: string; kind: string }> };

// kind: orders | receipts | returns | bills | payments.
export async function GET(request: Request, ctx: Params) {
  const { id, kind } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ documents: await listSupplierDocuments(client, context, id, kind) }));
}
