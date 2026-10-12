import { z } from "zod";

import { flagPosShiftForRecovery } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: a supervisor stops the shift for review (no sales, no closing) — with the reason.
const schema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ shift: await flagPosShiftForRecovery(client, context, id, input) }), 200, "pos.view");
}
