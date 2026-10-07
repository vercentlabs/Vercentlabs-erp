import { previewPurchaseOrder } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The totals a save would store, without saving (orderId: the draft being edited).
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    const { orderId, ...document } = input as Record<string, unknown>;
    return { preview: await previewPurchaseOrder(client, context, document, typeof orderId === "string" ? orderId : null) };
  }, 200, "procurement.po.create");
}
