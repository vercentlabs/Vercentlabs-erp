import { z } from "zod";

import { beginShiftClosing } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: start closing — no new checkout or payment on this shift from now on. A supervisor closing someone else's gives a reason.
const schema = z.object({ expectedVersion: z.number().int().positive().optional(), reason: z.string().trim().max(500).optional(), takeOver: z.boolean().optional(), force: z.boolean().optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ context: await beginShiftClosing(client, context, id, input) }), 200, "pos.shift.close");
}
