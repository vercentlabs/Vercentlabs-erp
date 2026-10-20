import { getPartyStatement } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ side: string; partyId: string }> };

// A customer's or supplier's statement between two dates, from the ledger.
export async function GET(request: Request, { params }: Params) {
  const { side, partyId } = await params;
  const url = new URL(request.url);
  const filters = { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined };
  return accountingRead(request, async (client, context) => {
    if (side !== "receivable" && side !== "payable") throw new HttpError(404, "Unknown ledger.");
    return { statement: await getPartyStatement(client, context, side, partyId, filters) };
  });
}
