import { z } from "zod";

import { listPosReceiptDeliveries, sendPosDigitalReceipts } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The sale's digital receipts and their outcome (sent, failed, not configured).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ deliveries: await listPosReceiptDeliveries(client, context, id) }), "pos.view");
}

// Send the receipts agreed at checkout, or one more: { channel, destination, consent } (RECEIPT_REPRINT), { resend }.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({ channel: z.enum(["email", "sms"]).optional(), destination: z.string().max(254).optional(), consent: z.boolean().optional(), resend: z.boolean().optional() });
  return posMutation(request, schema, async (client, context, input) => ({ deliveries: await sendPosDigitalReceipts(client, context, id, input) }), 200, "pos.view");
}
