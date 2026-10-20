import { getPartyAging } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ side: string }> };

// Receivables or payables aging: each party's open items by days past due, with the credits it holds.
export async function GET(request: Request, { params }: Params) {
  const { side } = await params;
  const asOf = new URL(request.url).searchParams.get("asOf") ?? undefined;
  return accountingRead(request, async (client, context) => {
    if (side !== "receivable" && side !== "payable") throw new HttpError(404, "Unknown ledger.");
    return { aging: await getPartyAging(client, context, side, { asOf }) };
  });
}
