import { z } from "zod";

import { getProductionEntry, updateProductionEntryDraft } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One production entry: output, its quality decisions, receipts, corrections and timeline.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ entry: await getProductionEntry(client, context, id) }));
}

const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
const schema = z.object({
  expectedVersion: z.number().int().optional(), quantity: quantity.optional(), uomId: z.string().uuid().optional(), productionBatchId: z.string().uuid().optional(),
  productionLocationId: z.string().uuid().nullable().optional(), producedAt: z.string().max(40).nullable().optional(), notes: z.string().max(1000).optional(),
  acceptedQuantity: quantity.optional(), rejectedQuantity: quantity.optional(), pendingQuantity: quantity.optional(), rejectionReason: z.string().max(500).optional(),
});

// Edit a draft under its version.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    await updateProductionEntryDraft(client, context, id, input);
    return { entry: await getProductionEntry(client, context, id) };
  });
}
