import { z } from "zod";

import { overridePosCartLinePrice } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string; lineId: string }> };

// body: { unitPrice (null: back to the list price), reason, approvalId?, expectedVersion, idempotencyKey? } — PRICE_OVERRIDE within the
// cashier's limit, or with a supervisor's approval for this version of the bill. The item and price list never change.
export async function POST(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  const schema = z.object({
    unitPrice: z.union([z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), z.number().min(0)]).nullable(),
    reason: z.string().trim().max(500).optional(),
    approvalId: z.string().uuid().optional(),
    expectedVersion: z.number().int(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await overridePosCartLinePrice(client, context, id, lineId, input) }), 200, "pos.sale.create");
}
