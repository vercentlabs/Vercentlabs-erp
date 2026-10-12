import { z } from "zod";

import { resolvePosPaymentException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };

// Resolve a payment exception (pos.reconciliation.manage): refund the credit through the provider, or close it with a note. Never by
// changing an amount or a merchant account. A held attempt is then marked not applied, freeing its bill.
export async function POST(request: Request, { params }: Params) {
  const { exceptionId } = await params;
  const schema = z.object({ action: z.enum(["refund", "resolve"]), note: z.string().trim().max(500) });
  return posMutation(request, schema, async (client, context, input) => ({ exception: await resolvePosPaymentException(client, context, exceptionId, input) }), 200,
    "pos.reconciliation.manage");
}
