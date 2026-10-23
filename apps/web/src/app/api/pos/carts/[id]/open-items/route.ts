import { z } from "zod";

import { addPosCartLine, getPosOpenItemOptions } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// An open item (Create-Where-You-Are POS1): something not in the catalogue, billed by a typed name, price, GST category and HSN/SAC. The
// server checks pos.open_item, the category and the tax at this outlet; the request key makes a retried add count once.
export async function GET(request: Request) {
  return posRead(request, (client, context) => getPosOpenItemOptions(client, context), "pos.sale.create");
}

const schema = z.object({
  itemName: z.string().trim().min(1).max(300),
  unitPrice: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
  quantity: z.number().positive().optional(),
  hsnSac: z.string().trim().max(12).optional().nullable(),
  taxCategoryId: z.string().uuid().optional().nullable(),
  expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({
    cart: await addPosCartLine(client, context, id, { ...input, itemId: undefined, quantity: input.quantity ?? 1 }),
  }), 200, "pos.sale.create");
}
