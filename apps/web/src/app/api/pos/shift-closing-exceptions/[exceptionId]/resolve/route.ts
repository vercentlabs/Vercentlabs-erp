import { z } from "zod";

import { resolveShiftClosingException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };

// POST: resolve an exception with what was done (its owner or a manager).
const schema = z.object({ resolutionNote: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: Params) {
  const { exceptionId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ exception: await resolveShiftClosingException(client, context, exceptionId, input) }), 200, "pos.view");
}
