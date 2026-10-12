import { z } from "zod";

import { startReconciliationRun } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: run reconciliation over a period — provider inquiry, detection, bank matching, settlement posting, Z report status.
const schema = z.object({ runType: z.enum(["ALL", "PAYMENT", "REFUND", "SETTLEMENT", "BANK"]).optional(), merchantAccountId: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(120) });

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ run: await startReconciliationRun(client, context, input) }), 201, "pos.view");
}
