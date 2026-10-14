import { retireCostRate, updateCostRateDraft } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

const schema = z.object({
  component: z.enum(["LABOR", "OVERHEAD"]).optional(), basis: z.enum(["PER_GOOD_UNIT", "PER_BATCH", "PCT_OF_MATERIAL"]).optional(),
  rate: z.union([z.string(), z.number()]).transform((value) => String(value)).optional(), categoryId: z.string().uuid().nullable().optional(), finishedItemId: z.string().uuid().nullable().optional(),
  uomId: z.string().uuid().nullable().optional(), effectiveFrom: z.string().max(10).nullable().optional(), effectiveUntil: z.string().max(10).nullable().optional(),
  name: z.string().max(200).nullable().optional(), zeroReason: z.string().max(500).nullable().optional(), notes: z.string().max(500).nullable().optional(), expectedVersion: z.number().int().optional(),
});
// Edit a draft rate (an approved rate is never edited; a new one replaces it).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => updateCostRateDraft(client, context, id, input));
}
// Retire a rate (orders keep the rates they were released under).
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, z.record(z.string(), z.unknown()), async (client, context) => retireCostRate(client, context, id));
}
