import { z } from "zod";

import { recordCashDifferenceFinanceTreatment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ differenceId: string }> };

// POST: Finance records how it accounted for the difference and its journal reference — once.
const schema = z.object({ treatment: z.enum(["SHORTAGE_EXPENSE", "OVERAGE_INCOME", "SUSPENSE", "NO_ENTRY"]), reference: z.string().trim().max(120).optional() });

export async function POST(request: Request, { params }: Params) {
  const { differenceId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ difference: await recordCashDifferenceFinanceTreatment(client, context, differenceId, input) }), 200, "pos.view");
}
