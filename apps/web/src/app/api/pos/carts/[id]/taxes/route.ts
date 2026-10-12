import { getPosCartTaxes } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The bill's tax as it stands, from the shared tax engine: the breakdown, or why it cannot be calculated. Never changes the bill.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ taxes: await getPosCartTaxes(client, context, id) }), "pos.view");
}
