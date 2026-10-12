import { z } from "zod";

import { createPosReceiptPrintJob } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: print the sale's receipt. The first print of the cashier's own sale in their open session is the original (RECEIPT_PRINT); anything
// else is a copy — "reprint" (RECEIPT_REPRINT + TRANSACTION_LOOKUP), marked COPY — REPRINTED, with an optional reason (required when the company
// says so). "auto" is the counter's automatic print — once per document. One idempotency key per deliberate action: the same key and request
// returns the same job; the same key with a different request is refused. Never changes the sale, its payments, stock or accounting.
const schema = z.object({
  printerId: z.string().uuid().optional(),
  terminalId: z.string().uuid().optional(),
  width: z.union([z.literal(58), z.literal(80), z.literal(210)]).optional(),
  requestType: z.enum(["auto", "manual", "reprint"]).optional(),
  documentVersion: z.number().int().positive().optional(),
  reasonCode: z.enum(["customer_request", "receipt_lost", "printer_failed", "receipt_damaged", "finance_verification", "audit_request", "other"]).optional(),
  reasonNote: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => createPosReceiptPrintJob(client, context, "pos_sale", id, input), 201, "pos.view");
}
