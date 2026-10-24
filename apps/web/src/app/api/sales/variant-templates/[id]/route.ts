import { getVariantGrid } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// One product's variants as a grid: rows by its first attribute, columns by its second.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => ({ grid: await getVariantGrid(client, context, id) }));
}
