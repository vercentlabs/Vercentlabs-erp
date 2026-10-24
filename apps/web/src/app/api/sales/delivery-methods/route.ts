import { listDeliveryMethods, saveDeliveryMethod } from "@vercentlabs/api";

import { deliveryMethodSchema } from "@/features/sales/settings/delivery-method-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Delivery methods and their shipping cost rules (Sales report Phase 3); ?includeInactive=1 for Setup.
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "1";
  return salesRead(request, "sales.view", async (client, context) => listDeliveryMethods(client, context, { includeInactive }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", deliveryMethodSchema, async (client, context, input) => saveDeliveryMethod(client, context, input), 201);
}
