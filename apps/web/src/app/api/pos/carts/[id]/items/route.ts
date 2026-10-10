import { z } from "zod";

import { addProductToPosCart } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Add a product (or one more of it) to the cart. The server checks the exact product, unit, price and stock again; the request key makes a
// retried or double-fired add count once. Prices and stock from the client are never read.
const schema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid().optional().nullable(),
  quantity: z.union([z.number().positive(), z.string().regex(/^\d{1,9}(\.\d{1,6})?$/)]).optional(),
  barcode: z.string().trim().max(64).optional().nullable(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => {
    const cart = await addProductToPosCart(client, context, id, { ...input, uomId: input.uomId ?? null, quantity: input.quantity ?? 1 });
    return { cart, replayed: Boolean((cart as { replayed?: boolean }).replayed) };
  }, 200, "pos.sale.create");
}
