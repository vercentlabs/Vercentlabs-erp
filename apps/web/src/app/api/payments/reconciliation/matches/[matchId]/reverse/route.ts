import { z } from "zod";

import { reverseMatch } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ matchId: string }> };

// POST: reverse a wrong match — an audited correction; the evidence stays.
const schema = z.object({ reason: z.string().trim().min(1).max(500), expectedVersion: z.number().int().positive().optional() });

export async function POST(request: Request, { params }: Params) {
  const { matchId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ match: await reverseMatch(client, context, matchId, input) }), 200, "pos.view");
}
