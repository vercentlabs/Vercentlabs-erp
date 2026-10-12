import { z } from "zod";

import { resolvePosShiftRecovery } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: a supervisor (not the shift's cashier) clears the review, recording what was found; the cashier then signs in again to carry on.
const schema = z.object({ resolution: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ shift: await resolvePosShiftRecovery(client, context, id, input) }), 200, "pos.view");
}
