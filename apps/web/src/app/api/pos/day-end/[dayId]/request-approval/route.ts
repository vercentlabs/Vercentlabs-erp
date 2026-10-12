import { z } from "zod";

import { requestDayEndApproval } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// POST: ask for approval of the approvable exceptions, for exactly the current figures.
const schema = z.object({ note: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ readiness: await requestDayEndApproval(client, context, dayId, input) }), 200, "pos.view");
}
