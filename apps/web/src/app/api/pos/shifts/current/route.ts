import { getCurrentPosShift } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: your open shift (restored after a refresh or a lost connection), or null.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => ({ shift: await getCurrentPosShift(client, context) }), "pos.view");
}
