import { z } from "zod";

import { setPosCartNotes } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// body: { notes, expectedVersion, idempotencyKey? } — an optional note on the sale.
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const schema = z.object({ notes: z.string().max(500).nullable(), expectedVersion: z.number().int(), idempotencyKey: z.string().min(8).max(100).optional() });
  return posMutation(request, schema, async (client, context, input) => ({ cart: await setPosCartNotes(client, context, id, input) }), 200, "pos.sale.create");
}
