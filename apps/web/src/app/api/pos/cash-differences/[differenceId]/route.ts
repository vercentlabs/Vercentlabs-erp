import { getCashDifference } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ differenceId: string }> };

// GET: one cash difference case with its history.
export async function GET(request: Request, { params }: Params) {
  const { differenceId } = await params;
  return posRead(request, async (client, context) => ({ difference: await getCashDifference(client, context, differenceId) }), "pos.view");
}
