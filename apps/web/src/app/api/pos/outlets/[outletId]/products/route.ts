import { z } from "zod";

import { getPosOutletProductSettings, updatePosOutletProductSettings } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

// The outlet's product search settings: assortment, stock display, low-stock level and frequent sellers.
export async function GET(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posRead(request, async (client, context) => getPosOutletProductSettings(client, context, outletId));
}

const schema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
  assortmentPolicy: z.enum(["all_sellable", "selected_categories"]).optional(),
  categoryIds: z.array(z.string().uuid()).max(500).optional(),
  showStockStatus: z.boolean().optional(),
  showExactStock: z.boolean().optional(),
  lowStockThreshold: z.union([z.string(), z.number()]).optional(),
  suggestFrequent: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posMutation(request, schema, async (client, context, input) => updatePosOutletProductSettings(client, context, outletId, input));
}
