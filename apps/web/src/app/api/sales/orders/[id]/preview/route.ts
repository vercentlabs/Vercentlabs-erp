import { previewSalesOrder } from "@vercentlabs/api";

import { projectDocumentPreview } from "@/features/sales/shared/preview-projection";
import { salesMutation } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

// The totals a save of this draft order would store. Lines that came from the
// quotation keep their quoted price, discount and tax, exactly as saving does.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", documentSchema, async (client, context, input) => ({
    preview: projectDocumentPreview(await previewSalesOrder(client, context, id, input), context),
  }));
}
