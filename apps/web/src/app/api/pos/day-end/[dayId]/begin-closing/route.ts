import { z } from "zod";

import { beginDayEndClosing } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// POST: start closing the day (selling on the next day is never held up).
const schema = z.object({ expectedVersion: z.number().int().positive().optional() });

export async function POST(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ readiness: await beginDayEndClosing(client, context, dayId, input) }), 200, "pos.view");
}
