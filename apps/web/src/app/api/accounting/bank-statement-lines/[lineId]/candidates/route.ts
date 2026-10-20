import { getLineCandidates } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ lineId: string }> };

// The ledger entries a statement line could be (same direction, not more than the line, within 30 days), best first.
export async function GET(request: Request, { params }: Params) {
  const { lineId } = await params;
  return accountingRead(request, async (client, context) => ({ candidates: await getLineCandidates(client, context, lineId) }));
}
