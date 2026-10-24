import { z } from "zod";

import { submitFieldOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A quick order from the phone, saved once per phone key (an offline sync may send it twice).
const schema = z.object({
  partyId: z.string().uuid(), idempotencyKey: z.string().min(8).max(120), note: z.string().max(1000).optional(), orderDate: z.string().date().optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().positive(), uomId: z.string().uuid().optional() })).min(1).max(200),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.order.create", schema, async (client, context, input) => submitFieldOrder(client, context, input), 201);
}
