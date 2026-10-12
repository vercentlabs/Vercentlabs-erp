import { z } from "zod";

import { resolveCashDifference } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ differenceId: string }> };

// POST: resolve the case with the authorized outcome (a correction links the authorized cash movement; never invented here).
const schema = z.object({
  resolutionType: z.enum(["SHORTAGE_ACCEPTED", "OVERAGE_ACCEPTED", "CASH_MOVEMENT_CORRECTION", "CUSTODY_RESOLVED", "SAME_AS_LINKED_DIFFERENCE", "OTHER"]),
  resolutionNote: z.string().trim().min(1).max(500),
  movementId: z.string().uuid().optional(),
  relatedDifferenceId: z.string().uuid().optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { differenceId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ difference: await resolveCashDifference(client, context, differenceId, input) }), 200, "pos.view");
}
