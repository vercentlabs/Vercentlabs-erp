import { z } from "zod";

import { updateReconciliationException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ exceptionId: string }> };

// POST: assign, investigate, await evidence, escalate, add a note or evidence, or ask for approval of a resolution.
const schema = z.object({
  action: z.enum(["assign", "investigate", "await_evidence", "escalate", "note", "evidence", "request_approval"]),
  assignedTo: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
  evidence: z.object({ kind: z.string().trim().max(40).optional(), reference: z.string().trim().min(1).max(200), note: z.string().trim().max(300).optional() }).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { exceptionId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ exception: await updateReconciliationException(client, context, exceptionId, input) }), 200, "pos.view");
}
