import { z } from "zod";

import { investigateCashDifference } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ differenceId: string }> };

// POST: take or assign the case and add a note — the difference itself never changes.
const schema = z.object({ note: z.string().trim().min(1).max(500), assignedTo: z.string().uuid().optional() });

export async function POST(request: Request, { params }: Params) {
  const { differenceId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ difference: await investigateCashDifference(client, context, differenceId, input) }), 200, "pos.view");
}
