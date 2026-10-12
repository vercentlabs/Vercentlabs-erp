import { getZReportForDay } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// GET: the finalized Z report of the day, exactly as frozen.
export async function GET(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posRead(request, async (client, context) => ({ report: await getZReportForDay(client, context, dayId) }), "pos.view");
}
