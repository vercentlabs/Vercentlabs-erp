import { z } from "zod";

import { getPosReturn, updatePosReturn } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the return — lines with reason, condition, disposition and amounts; exceptions and approval; refunds and their status; documents.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ posReturn: await getPosReturn(client, context, id) }), "pos.view");
}

// PATCH: change an unposted return. Any change voids an approval (the return goes back to draft).
const lineSchema = z.object({
  saleLineId: z.string().uuid(),
  quantity: z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()]).transform((value) => String(value)),
  reasonCode: z.enum(["damaged_product", "defective_product", "wrong_item", "wrong_size_variant", "customer_changed_mind", "quality_issue", "not_as_described", "other"]).optional(),
  reasonNote: z.string().trim().max(300).optional(),
  conditionCode: z.enum(["unopened", "good", "opened", "damaged", "defective"]).optional(),
  dispositionCode: z.enum(["return_hold", "restock_approved", "damaged", "quarantined", "rejected_not_received"]).optional(),
  serialId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
});
const schema = z.object({
  lines: z.array(lineSchema).min(1).max(200).optional(),
  receiptPresent: z.boolean().optional(),
  overrideReason: z.string().trim().max(300).nullish(),
  expectedVersion: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await updatePosReturn(client, context, id, input) }), 200, "pos.view");
}
