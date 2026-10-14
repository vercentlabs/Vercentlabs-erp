import { z } from "zod";

import { getManufacturingBom, updateBomDraft } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One revision: its recipe, validation, change log and the BOM around it.
export async function GET(request: Request, ctx: { params: Promise<{ bomId: string; revisionId: string }> }) {
  const { bomId, revisionId } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ bom: await getManufacturingBom(client, context, bomId, { revisionId }) }));
}

// Edit a draft revision (the full list of lines replaces the old one; each line keeps its lineage); expectedVersion protects against a
// concurrent edit.
const schema = z.object({ expectedVersion: z.number().int().optional(), changeReason: z.string().max(500).optional(), editReason: z.string().max(500).optional(),
  outputQuantity: z.union([z.string(), z.number()]).optional(), outputUomId: z.string().uuid().optional(),
  expectedYieldPct: z.union([z.string(), z.number()]).optional(), batchSize: z.union([z.string(), z.number()]).nullable().optional(),
  description: z.string().max(4000).nullable().optional(), defaultWarehouseId: z.string().uuid().nullable().optional(), name: z.string().max(200).nullable().optional(),
  lines: z.array(z.object({ componentItemId: z.string().uuid(), quantity: z.union([z.string(), z.number()]), uomId: z.string().uuid(),
    consumptionMode: z.enum(["PROPORTIONAL", "FIXED_PER_BATCH"]).optional(), scrapAllowancePct: z.union([z.string(), z.number()]).optional(),
    childBomRevisionId: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional(), lineageId: z.string().uuid().nullable().optional() })).max(500).optional() });

export async function PATCH(request: Request, ctx: { params: Promise<{ bomId: string; revisionId: string }> }) {
  const { revisionId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ bom: await updateBomDraft(client, context, revisionId, input) }));
}
