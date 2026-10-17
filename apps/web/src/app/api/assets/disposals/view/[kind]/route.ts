import { getDisposalAudit, getDisposalOptions, getDisposalReport, getSaleScrapExecutionQueue, listDisposalExceptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET execution (?type=SALE|SCRAP&milestone=) · options · exceptions (?status=OPEN|RESOLVED) · report (?kind=) · audit (?assetId=)
type Params = { params: Promise<{ kind: string }> };
export async function GET(request: Request, ctx: Params) {
  const { kind } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (kind) {
      case "options": return getDisposalOptions(client, context);
      case "exceptions": return listDisposalExceptions(client, context, { status: get("status") ?? "OPEN" });
      case "report": return getDisposalReport(client, context, get("kind") ?? "register", { book: get("book"), period: get("period"), category: get("category"), method: get("method"), asset: get("asset"),
        result: get("result"), status: get("status"), location: get("location"), department: get("department") });
      case "audit": return getDisposalAudit(client, context, { assetId: get("assetId") });
      case "execution": return getSaleScrapExecutionQueue(client, context, { type: get("type"), milestone: get("milestone") });
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
