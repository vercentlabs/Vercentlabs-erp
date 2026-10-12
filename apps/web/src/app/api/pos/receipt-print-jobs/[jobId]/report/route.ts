import { z } from "zod";

import { reportPosReceiptPrintJob } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ jobId: string }> };

// POST: what the browser saw — the print dialog opened (DISPATCHED, not proof of paper), was cancelled, failed, or the outcome is unknown.
const schema = z.object({ outcome: z.enum(["dialog_opened", "cancelled", "failed", "unknown"]), errorCode: z.string().trim().max(60).optional() });

export async function POST(request: Request, { params }: Params) {
  const { jobId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ job: await reportPosReceiptPrintJob(client, context, jobId, input) }), 200, "pos.view");
}
