import { z } from "zod";

import { approveManualMatch } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ matchId: string }> };

// POST: approve a material manual match (not its author).
const schema = z.object({ expectedVersion: z.number().int().positive().optional() });

export async function POST(request: Request, { params }: Params) {
  const { matchId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ match: await approveManualMatch(client, context, matchId, input) }), 200, "pos.view");
}
