import { getPartyOpenItems } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ side: string; partyId: string }> };

// One party's open items (the aging drill-down).
export async function GET(request: Request, { params }: Params) {
  const { side, partyId } = await params;
  const asOf = new URL(request.url).searchParams.get("asOf") ?? undefined;
  return accountingRead(request, async (client, context) => {
    if (side !== "receivable" && side !== "payable") throw new HttpError(404, "Unknown ledger.");
    return { items: await getPartyOpenItems(client, context, side, partyId, { asOf }) };
  });
}
