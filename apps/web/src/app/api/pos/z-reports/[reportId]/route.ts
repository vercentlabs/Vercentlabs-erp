import { getZReport } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ reportId: string }> };

// GET: a finalized Z report, exactly as frozen (verified against its hash).
export async function GET(request: Request, { params }: Params) {
  const { reportId } = await params;
  return posRead(request, async (client, context) => ({ report: await getZReport(client, context, reportId) }), "pos.view");
}
