import { getReconciliationException } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };

// GET: an exception with its references, evidence, notes and matches.
export async function GET(request: Request, { params }: Params) {
  const { exceptionId } = await params;
  return posRead(request, async (client, context) => ({ exception: await getReconciliationException(client, context, exceptionId) }), "pos.view");
}
