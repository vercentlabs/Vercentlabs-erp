import { z } from "zod";

import { resumePosShift } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: resume a paused shift — its own cashier, entering their password again.
const schema = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ shift: await resumePosShift(client, context, id, input) }), 200, "pos.view");
}
