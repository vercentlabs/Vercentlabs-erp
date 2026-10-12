import { getDayEndReadiness } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// GET: blocking, approvable and tracked exceptions, recorded against the day, and whether it can be finalized.
export async function GET(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posRead(request, async (client, context) => ({ readiness: await getDayEndReadiness(client, context, dayId) }), "pos.view");
}
