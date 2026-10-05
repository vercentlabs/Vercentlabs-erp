import { z } from "zod";

import { getDelivery, updateDraftDelivery } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.delivery.view", async (client, context) => ({ delivery: await getDelivery(client, context, id) }));
}

// Before dispatch: the lines (while a Draft), the ship-to address and contact, dates, instructions, notes and packages.
const nullableText = (max: number) => z.string().max(max).nullable().optional();
const schema = z.object({
  expectedVersion: z.number().int().optional(),
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).max(500).optional(),
  shippingAddressId: z.string().uuid().optional(),
  addressChangeReason: z.string().max(500).optional(),
  contactId: z.string().uuid().nullable().optional(),
  expectedDeliveryDate: z.string().date().nullable().optional(),
  deliveryInstructions: nullableText(2000),
  internalNotes: nullableText(2000),
  packageCount: z.number().int().min(0).nullable().optional(),
  packageNotes: nullableText(1000),
});

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.edit", schema, async (client, context, input) => ({ result: await updateDraftDelivery(client, context, id, input) }));
}
