import { z } from "zod";

import { snapshotBomForProduction } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Freeze the recipe effective on the production date for production (a production order keeps this snapshot; later revisions never change it).
const schema = z.object({
  itemId: z.string().uuid().optional(), revisionId: z.string().uuid().optional(), plannedQuantity: z.union([z.string(), z.number()]), uomId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(), policy: z.enum(["MANUFACTURE_REQUIRED_SUBASSEMBLIES", "USE_STOCKED_SUBASSEMBLIES"]).optional(),
  choices: z.record(z.string(), z.union([z.enum(["MAKE", "USE_STOCK"]), z.object({ useFromStock: z.union([z.string(), z.number()]) })])).optional(),
  productionDate: z.string().max(40).optional(), sourceType: z.string().max(50).optional(), sourceId: z.string().uuid().optional(), sourceReference: z.string().max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => ({ snapshot: await snapshotBomForProduction(client, context, input) }), 201);
}
