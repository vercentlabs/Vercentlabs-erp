import { getReconciliationRun } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ runId: string }> };

// GET: a run's status and counts.
export async function GET(request: Request, { params }: Params) {
  const { runId } = await params;
  return posRead(request, async (client, context) => ({ run: await getReconciliationRun(client, context, runId) }), "pos.view");
}
