import { getProcurementDocumentChain } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The document chain of a Procurement document: Quotation → PO → GRN → Bill → Payment with each step's documents (Procurement plan Phase 1).
type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { type, id } = await ctx.params;
  return procurementRead(request, async (client, context) => getProcurementDocumentChain(client, context, type, id));
}
