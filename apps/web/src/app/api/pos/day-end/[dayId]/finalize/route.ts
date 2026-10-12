import { z } from "zod";

import { finalizeZReport } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// POST: finalize the Z report — figures must match the reviewed preview; one per day; a repeated key returns the same report.
const schema = z.object({ expectedVersion: z.number().int().positive().optional(), expectedPreviewHash: z.string().trim().min(16).max(128), idempotencyKey: z.string().trim().min(8).max(120) });

export async function POST(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ result: await finalizeZReport(client, context, dayId, input) }), 200, "pos.view");
}
