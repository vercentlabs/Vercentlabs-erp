import { z } from "zod";

import { getPosReceiptBranding, updatePosReceiptBranding } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posRead(request, async (client, context) => ({ branding: await getPosReceiptBranding(client, context, outletId) }), "pos.view");
}

// PUT: the outlet's receipt footer — message, return policy, support text, and whether the scannable reference is printed. Issued receipts
// keep the text they were printed with.
const schema = z.object({
  receiptMessage: z.string().max(200).nullish(),
  returnPolicy: z.string().max(500).nullish(),
  supportText: z.string().max(200).nullish(),
  referenceCodeEnabled: z.boolean().optional(),
});

export async function PUT(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ branding: await updatePosReceiptBranding(client, context, outletId, input) }), 200, "pos.settings.manage");
}
