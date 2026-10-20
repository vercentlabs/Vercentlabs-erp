import { getFinalDashboard, getIncomingCounts, listFinalOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// Final inspection reads: counts (the queues) · dashboard · options (inspectors, reported output, vocabularies).
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "counts": return { counts: await getIncomingCounts(client, context, { type: "final" }) };
      case "dashboard": return getFinalDashboard(client, context);
      case "options": return listFinalOptions(client, context);
      default: throw new HttpError(404, "Unknown final inspection view.");
    }
  }, "quality.final.view");
}
