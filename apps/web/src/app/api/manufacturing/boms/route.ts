import { z } from "zod";

import { createManufacturingBom, listManufacturingBoms } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Bills of materials: one per finished product, with its revisions.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["search", "status", "itemId", "componentItemId", "includeArchived"]) { const value = url.searchParams.get(key); if (value) filters[key] = value; }
  return manufacturingRead(request, async (client, context) => ({ boms: await listManufacturingBoms(client, context, filters) }));
}

const schema = z.object({ finishedItemId: z.string().uuid().optional(), outputQuantity: z.union([z.string(), z.number()]).optional(), outputUomId: z.string().uuid().optional(),
  expectedYieldPct: z.union([z.string(), z.number()]).optional(), batchSize: z.union([z.string(), z.number()]).nullable().optional(),
  description: z.string().max(4000).nullable().optional(), defaultWarehouseId: z.string().uuid().nullable().optional(), name: z.string().max(200).nullable().optional(),
  lines: z.array(z.object({ componentItemId: z.string().uuid(), quantity: z.union([z.string(), z.number()]), uomId: z.string().uuid(),
    consumptionMode: z.enum(["PROPORTIONAL", "FIXED_PER_BATCH"]).optional(), scrapAllowancePct: z.union([z.string(), z.number()]).optional(),
    childBomRevisionId: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional() })).max(500).optional() });

export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => ({ bom: await createManufacturingBom(client, context, input) }), 201);
}
