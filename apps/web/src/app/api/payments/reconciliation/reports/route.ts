import { getReconciliationReport } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET: a reconciliation report (?type=summary|unmatched|duplicates|unknown|settlements|settlement_aging|refunds|bank_unmatched|manual_matches|cash_links|clearing|day_end, from, to,
// format=csv for an export with spreadsheet formulas neutralised).
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => ({ report: await getReconciliationReport(client, context, params.type ?? "summary", params) }), "pos.view");
}
