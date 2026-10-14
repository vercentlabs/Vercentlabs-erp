import { previewManufacturingOrder } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";
import { orderHeaderSchema } from "@/features/manufacturing/orders/api/mo-schemas";

// What a new order would need (materials, availability, estimate, revision) without saving anything.
export async function POST(request: Request) {
  return manufacturingMutation(request, orderHeaderSchema, async (client, context, input) => ({ preview: await previewManufacturingOrder(client, context, input) }));
}
