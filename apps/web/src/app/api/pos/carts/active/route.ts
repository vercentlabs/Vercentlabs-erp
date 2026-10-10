import { getActivePosCart } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// The person's working bill on their open session's terminal (after a refresh or reconnection), and how many bills are held at that outlet.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => getActivePosCart(client, context), "pos.view");
}
