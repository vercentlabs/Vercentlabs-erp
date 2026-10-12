import { getPosReceiptPrintJob } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { jobId } = await params;
  return posRead(request, async (client, context) => ({ job: await getPosReceiptPrintJob(client, context, jobId) }), "pos.view");
}
