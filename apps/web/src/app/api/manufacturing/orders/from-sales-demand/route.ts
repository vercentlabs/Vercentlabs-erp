import { z } from "zod";

import { createManufacturingOrderFromSales } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// A draft manufacturing order for demand lines of one product, with a proposed allocation per line; the same key returns the same order.
const schema = z.object({
  lines: z.array(z.object({ demandId: z.string().uuid(), quantity: z.union([z.string(), z.number()]) })).min(1).max(50),
  plannedQuantity: z.union([z.string(), z.number()]).optional(), plannedStartAt: z.string().max(40), plannedEndAt: z.string().max(40),
  materialWarehouseId: z.string().uuid().optional(), manufacturingWarehouseId: z.string().uuid().optional(), priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
  notes: z.string().max(4000).optional(), expectedVersions: z.record(z.string(), z.number().int()).optional(), expectedPlannable: z.record(z.string(), z.string()).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => await createManufacturingOrderFromSales(client, context, input), 201);
}
