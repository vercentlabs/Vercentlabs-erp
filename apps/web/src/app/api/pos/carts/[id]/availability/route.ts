import { getPosCartAvailability } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the bill's items against what is available now (its own checkout reservation counts as its own), with a warning for each line asking
// for more than there is. Nothing is reserved by asking.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ availability: await getPosCartAvailability(client, context, id) }), "pos.view");
}
