import { getZReport } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ reportId: string }> };

// GET: the print-ready Z report (the frozen snapshot; the page renders it for A4 or the receipt printer).
export async function GET(request: Request, { params }: Params) {
  const { reportId } = await params;
  return posRead(request, async (client, context) => ({ document: await getZReport(client, context, reportId) }), "pos.view");
}
