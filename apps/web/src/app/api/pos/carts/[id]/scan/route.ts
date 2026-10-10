import { z } from "zod";

import { processPosScan } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// One completed scan: { barcode, scanActionId (new per scan), itemId? / serialNumber? / batchId? for its follow-up }. Always answers with an
// outcome — added, selection / serial / batch required, or rejected with a code and message — so every scan is accounted for. The same
// scanActionId retried returns the original outcome.
const schema = z.object({
  barcode: z.string().max(200),
  scanActionId: z.string().uuid(),
  itemId: z.string().uuid().optional().nullable(),
  serialNumber: z.string().max(64).optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  expectedCartVersion: z.number().int().optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ outcome: await processPosScan(client, context, id, input) }), 200, "pos.view");
}
