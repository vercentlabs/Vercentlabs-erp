import { getShiftOpeningContext } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

// GET: is this counter free, who has it, and is it ready to open (handover waiting, payment methods, warnings).
export async function GET(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posRead(request, async (client, context) => {
    const opening = await getShiftOpeningContext(client, context, { terminalId });
    return { counter: opening.counters.find((counter) => counter.terminalId === terminalId) ?? null, readiness: opening.readiness, currentShift: opening.currentShift };
  }, "pos.view");
}
