import { getIncomingCounts, getIncomingDashboard, listIncomingOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// Incoming Inspection reads: counts (the queues) · dashboard · options (inspectors, receipt lines, vocabularies).
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "counts": return { counts: await getIncomingCounts(client, context) };
      case "dashboard": return getIncomingDashboard(client, context);
      case "options": return listIncomingOptions(client, context);
      default: throw new HttpError(404, "Unknown incoming inspection view.");
    }
  }, "quality.incoming.view");
}
