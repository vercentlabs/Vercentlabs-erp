import { z } from "zod";

import { previewManufacturingFromSales } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// What a draft order for these demand lines would be: coverage, recommendation, feasibility and materials. Saves nothing.
const schema = z.object({ demandIds: z.array(z.string().uuid()).min(1).max(50), quantity: z.union([z.string(), z.number()]).optional(), plannedStartAt: z.string().max(40).optional(),
  plannedEndAt: z.string().max(40).optional(), materialWarehouseId: z.string().uuid().optional(), manufacturingWarehouseId: z.string().uuid().optional() });

export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => ({ preview: await previewManufacturingFromSales(client, context, input) }));
}
