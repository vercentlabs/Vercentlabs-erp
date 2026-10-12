import { z } from "zod";

import { cancelShiftClosing } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: back to selling (the counts so far are kept, superseded).
const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ context: await cancelShiftClosing(client, context, id, input) }), 200, "pos.shift.close");
}
