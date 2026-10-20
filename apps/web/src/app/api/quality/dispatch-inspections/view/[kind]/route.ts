import { getDispatchDashboard, getIncomingCounts, listDispatchOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// Pre-dispatch inspection reads: counts (the queues) · dashboard · options (inspectors, reported output, vocabularies).
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "counts": return { counts: await getIncomingCounts(client, context, { type: "pre_dispatch" }) };
      case "dashboard": return getDispatchDashboard(client, context);
      case "options": return listDispatchOptions(client, context);
      default: throw new HttpError(404, "Unknown pre-dispatch inspection view.");
    }
  }, "quality.dispatch.view");
}
