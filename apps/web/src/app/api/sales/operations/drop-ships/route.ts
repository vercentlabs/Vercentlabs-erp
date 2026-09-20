import { z } from "zod";

import { createSalesDropShipRequest } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  salesOrderId: z.string().uuid(),
  salesOrderLineId: z.string().uuid(),
  supplierId: z.string().uuid(),
  quantity: z.union([z.number(), z.string()]),
  shipToAddressId: z.string().uuid().nullish(),
  idempotencyKey: z.string().trim().max(200).nullish(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({ dropShip: await createSalesDropShipRequest(client, context, input) }), 201);
}
