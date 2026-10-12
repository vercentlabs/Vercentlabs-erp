import { z } from "zod";

import { suspendPosShift } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: pause the shift — no new sales until its cashier signs in again. A supervisor pausing someone else's gives a reason.
const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ shift: await suspendPosShift(client, context, id, input) }), 200, "pos.view");
}
