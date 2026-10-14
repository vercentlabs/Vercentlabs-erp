import { z } from "zod";

import { allocateManufacturingSupply } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Assign an existing manufacturing order's output to a demand.
const schema = z.object({ demandId: z.string().uuid(), manufacturingOrderId: z.string().uuid(), quantity: z.union([z.string(), z.number()]), idempotencyKey: z.string().trim().min(1).max(200).optional() });

export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => await allocateManufacturingSupply(client, context, input), 201);
}
