import { z } from "zod";

import { approveDayEndExceptions } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// POST: approve the requested exceptions (someone other than the requester), bound to the figures reviewed.
const schema = z.object({ previewHash: z.string().trim().min(16).max(128), note: z.string().trim().max(500).optional() });

export async function POST(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ readiness: await approveDayEndExceptions(client, context, dayId, input) }), 200, "pos.view");
}
