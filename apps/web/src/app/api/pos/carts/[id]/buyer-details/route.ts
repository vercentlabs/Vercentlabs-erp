import { z } from "zod";

import { updateWalkInBuyerDetails } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// A walk-in buyer's name and address for the invoice (no GSTIN: a business invoice is a registered customer's).
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({
    name: z.string().max(200).nullable().optional(),
    address: z.object({ line1: z.string().max(200).nullable().optional(), line2: z.string().max(200).nullable().optional(), city: z.string().max(100).nullable().optional(),
      stateCode: z.string().max(2).nullable().optional(), postalCode: z.string().max(10).nullable().optional() }).optional(),
    gstin: z.string().max(20).nullable().optional(),
    expectedVersion: z.number().int(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await updateWalkInBuyerDetails(client, context, id, input as Parameters<typeof updateWalkInBuyerDetails>[3]) }), 200, "pos.sale.create");
}
