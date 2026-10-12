import { getPosReceiptReprintEligibility } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET ?terminalId=: before printing — the return's document and its standing (cancelled / returned / kept from the sale record), whether the
// next print is the original or a copy, whether this person may print it, the outlet's printers, and whether a reprint needs a reason.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const terminalId = new URL(request.url).searchParams.get("terminalId") ?? undefined;
  return posRead(request, async (client, context) => ({ eligibility: await getPosReceiptReprintEligibility(client, context, "pos_return", id, { terminalId }) }), "pos.view");
}
