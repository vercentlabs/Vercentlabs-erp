import { resolveSupplierDefaults } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What a new document would take from this supplier (an active one only). purpose: rfq | purchase_order | goods_receipt | bill | return.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const purpose = new URL(request.url).searchParams.get("purpose") ?? "purchase_order";
  return procurementRead(request, async (client, context) => ({ defaults: await resolveSupplierDefaults(client, context, id, purpose) }));
}
