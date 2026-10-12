import { z } from "zod";

import { recordPosOpeningCorrection } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// POST: a supervisor records a counting mistake found after opening — beside the confirmed count, never editing it, and never as a cash movement.
const schema = z.object({ correctedAmount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/), reason: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: Params) {
  const { sessionId: id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ cashSession: await recordPosOpeningCorrection(client, context, id, input) }), 201, "pos.view");
}
