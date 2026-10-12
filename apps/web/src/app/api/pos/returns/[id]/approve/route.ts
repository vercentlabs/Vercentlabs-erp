import { z } from "zod";

import { approvePosReturn } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: a supervisor approves exactly this version — never the person who started it; with the grant for every exception it carries.
const schema = z.object({ expectedVersion: z.number().int().optional(), note: z.string().trim().max(300).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await approvePosReturn(client, context, id, input) }), 200, "pos.view");
}
