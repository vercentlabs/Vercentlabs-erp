import { z } from "zod";

import { assignShiftClosingException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: a supervisor hands an unknown card / UPI outcome to an accountable owner so the close can go ahead.
const schema = z.object({ exceptionType: z.enum(["PAYMENT_UNKNOWN", "SPLIT_PAYMENT"]), referenceId: z.string().uuid(), assignedTo: z.string().uuid().optional(), note: z.string().trim().min(1).max(500) });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ blockers: await assignShiftClosingException(client, context, id, input) }), 201, "pos.view");
}
