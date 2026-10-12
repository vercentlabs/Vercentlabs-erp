import { getShiftClosingReport } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the closing report from the immutable snapshot (?variant=CASHIER|RECONCILIATION).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const options = { variant: new URL(request.url).searchParams.get("variant") };
  return posRead(request, async (client, context) => ({ report: await getShiftClosingReport(client, context, id, options) }), "pos.view");
}
