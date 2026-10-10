import { z } from "zod";

import { setReceiptDeliveryContact } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Where to send the digital receipt, with the customer's agreement — receipt only, never marketing, never a customer record.
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({ phone: z.string().max(20).nullable().optional(), email: z.string().max(254).nullable().optional(), consent: z.boolean().optional(),
    expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100).optional() });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await setReceiptDeliveryContact(client, context, id, input) }), 200, "pos.sale.create");
}
