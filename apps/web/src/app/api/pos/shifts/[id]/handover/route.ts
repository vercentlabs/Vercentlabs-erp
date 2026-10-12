import { z } from "zod";

import { prepareCashHandover } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: check where the closing cash will go against the current count (recorded by the close itself).
const schema = z.object({ destinations: z.array(z.object({
  type: z.enum(["NEXT_SHIFT_HANDOVER", "STORE_SAFE", "AUTHORIZED_MANAGER", "SECURED_DRAWER_PENDING_HANDOVER"]),
  amount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  recipientUserId: z.string().uuid().optional().nullable(),
})).max(4) });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ handover: await prepareCashHandover(client, context, id, input) }), 200, "pos.shift.close");
}
