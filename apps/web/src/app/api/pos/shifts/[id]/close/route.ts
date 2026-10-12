import { z } from "zod";

import { closeShift } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: finalize the close — the current count (or countedAmount to count and close in one step), the difference's reason and any approval, where the cash goes,
// and a request key (a repeated key returns the same closing). A supervisor closing someone else's shift gives a reason; an outlet manager may force-close.
const schema = z.object({
  closingCountId: z.string().uuid().optional(),
  countedAmount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/).optional(),
  denominations: z.array(z.object({ denomination: z.number().positive(), count: z.number().int().min(0) })).max(20).optional(),
  varianceReasonCode: z.string().trim().max(40).optional(),
  varianceReason: z.string().trim().max(500).optional(),
  approvalId: z.string().uuid().optional().nullable(),
  destinations: z.array(z.object({
  type: z.enum(["NEXT_SHIFT_HANDOVER", "STORE_SAFE", "AUTHORIZED_MANAGER", "SECURED_DRAWER_PENDING_HANDOVER"]),
  amount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  recipientUserId: z.string().uuid().optional().nullable(),
})).max(4).optional(),
  expectedVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
  reason: z.string().trim().max(500).optional(),
  force: z.boolean().optional(),
  notes: z.string().trim().max(2_000).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ closing: await closeShift(client, context, id, input) }), 200, "pos.shift.close");
}
