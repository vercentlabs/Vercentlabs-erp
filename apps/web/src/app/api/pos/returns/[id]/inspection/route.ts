import { z } from "zod";

import { recordPosReturnInspection } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: inspection — the condition and final disposition of returned goods (restock, damaged, quarantine, not received). Supervisors.
const schema = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), conditionCode: z.enum(["unopened", "good", "opened", "damaged", "defective"]).optional(),
    dispositionCode: z.enum(["return_hold", "restock_approved", "damaged", "quarantined", "rejected_not_received"]) })).min(1), expectedVersion: z.number().int().optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await recordPosReturnInspection(client, context, id, input) }), 200, "pos.view");
}
