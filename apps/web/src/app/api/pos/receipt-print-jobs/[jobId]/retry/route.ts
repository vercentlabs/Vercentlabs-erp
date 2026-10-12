import { z } from "zod";

import { retryPosReceiptPrintJob } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ jobId: string }> };

// POST: print a job again. If it may already have printed, the cashier must confirm it did not (confirmNotPrinted).
const schema = z.object({ confirmNotPrinted: z.boolean().optional(), expectedDocumentVersion: z.number().int().positive().optional() });

export async function POST(request: Request, { params }: Params) {
  const { jobId } = await params;
  return posMutation(request, schema, async (client, context, input) => retryPosReceiptPrintJob(client, context, jobId, input), 200, "pos.view");
}
