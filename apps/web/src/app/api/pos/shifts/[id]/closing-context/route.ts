import { getShiftClosingContext } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: a named shift's closing context (a supervisor closing someone else's shift, or a closed shift's result).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ context: await getShiftClosingContext(client, context, { shiftId: id }) }), "pos.view");
}
