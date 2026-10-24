import { z } from "zod";

import { recordFieldCollection } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Money collected on the beat (cash, cheque or UPI), kept once per phone key, with a WhatsApp receipt.
const schema = z.object({
  partyId: z.string().uuid(), amount: z.number().positive(), method: z.enum(["cash", "cheque", "upi"]), idempotencyKey: z.string().min(8).max(120),
  chequeNumber: z.string().max(20).optional(), chequeDate: z.string().date().optional(), draweeBank: z.string().max(100).optional(), reference: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.invoice.record_payment", schema, async (client, context, input) => recordFieldCollection(client, context, input), 201);
}
