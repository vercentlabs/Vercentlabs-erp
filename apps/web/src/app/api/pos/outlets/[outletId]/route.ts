import { z } from "zod";

import { deleteOutlet, getOutlet, updateOutlet } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posRead(request, async (client, context) => ({ outlet: await getOutlet(client, context, outletId) }));
}

// Any outlet field, expectedVersion, reason.
export async function PATCH(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ outlet: await updateOutlet(client, context, outletId, input) }));
}

// Only an outlet nothing has used; anything else is deactivated.
export async function DELETE(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), (client, context) => deleteOutlet(client, context, outletId));
}
