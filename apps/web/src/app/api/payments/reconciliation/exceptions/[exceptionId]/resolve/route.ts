import { z } from "zod";

import { resolveReconciliationException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };

// POST: resolve with the resolution, a note and evidence (never a note alone; material resolutions need an approver).
const schema = z.object({
  resolutionType: z.enum(["MATCHED_WITH_EVIDENCE", "CHECKOUT_RECOVERED", "CUSTOMER_REFUNDED", "ACCEPTED_DIFFERENCE", "FINANCE_CORRECTION_POSTED", "PROVIDER_CORRECTED", "DUPLICATE_IGNORED", "OTHER"]),
  resolutionNote: z.string().trim().min(1).max(500),
  resolutionReference: z.string().trim().max(200).optional(),
  evidence: z.object({ kind: z.string().trim().max(40).optional(), reference: z.string().trim().min(1).max(200), note: z.string().trim().max(300).optional() }).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { exceptionId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ exception: await resolveReconciliationException(client, context, exceptionId, input) }), 200, "pos.view");
}
