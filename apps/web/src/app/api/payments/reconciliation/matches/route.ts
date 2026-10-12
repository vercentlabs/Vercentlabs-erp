import { z } from "zod";

import { applyManualMatch } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: a controlled manual match — reason and evidence; material matches wait for a second person's approval.
const schema = z.object({
  internalType: z.enum(["pos_payment", "payment_refund_component", "payment_settlement_batch"]),
  internalId: z.string().uuid(),
  externalType: z.enum(["payment_settlement_line", "accounting_bank_statement_line"]),
  externalId: z.string().uuid(),
  amount: z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/),
  reason: z.string().trim().min(1).max(500),
  evidence: z.array(z.object({ kind: z.string().trim().max(40).optional(), reference: z.string().trim().max(200).optional(), note: z.string().trim().max(300).optional() })).min(1).max(10),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ match: await applyManualMatch(client, context, input) }), 201, "pos.view");
}
