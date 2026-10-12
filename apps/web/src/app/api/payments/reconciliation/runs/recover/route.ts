import { z } from "zod";

import { recoverReconciliationRuns } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: mark runs left running (interrupted) as failed so they can run again.
const schema = z.object({});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context) => ({ result: await recoverReconciliationRuns(client, context) }), 200, "pos.view");
}
