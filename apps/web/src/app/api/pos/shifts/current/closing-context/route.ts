import { getShiftClosingContext } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: the caller's current shift (open, paused or closing) with everything the four closing steps need — so a refreshed browser resumes.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => ({ context: await getShiftClosingContext(client, context) }), "pos.view");
}
