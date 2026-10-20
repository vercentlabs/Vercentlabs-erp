import { getInProcessDashboard, getIncomingCounts, listInProcessOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// In-process inspection reads: counts (the queues) · dashboard · options (inspectors, reported output, vocabularies).
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "counts": return { counts: await getIncomingCounts(client, context, { type: "in_process" }) };
      case "dashboard": return getInProcessDashboard(client, context);
      case "options": return listInProcessOptions(client, context);
      default: throw new HttpError(404, "Unknown in-process inspection view.");
    }
  }, "quality.inprocess.view");
}
