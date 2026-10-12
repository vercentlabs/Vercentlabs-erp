import { buildXReport } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// GET: the X report — a read-only preview of the day as it stands (nothing written, no number used).
export async function GET(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posRead(request, async (client, context) => ({ preview: await buildXReport(client, context, dayId) }), "pos.view");
}
