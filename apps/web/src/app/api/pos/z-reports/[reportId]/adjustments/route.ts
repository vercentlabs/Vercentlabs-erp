import { listZReportAdjustments } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ reportId: string }> };

// GET: corrections and late events linked to the report (the report itself never changes).
export async function GET(request: Request, { params }: Params) {
  const { reportId } = await params;
  return posRead(request, async (client, context) => ({ adjustments: await listZReportAdjustments(client, context, reportId) }), "pos.view");
}
