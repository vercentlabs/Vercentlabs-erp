import { getNonconformanceCounts, getNonconformanceDashboard, listNonconformanceOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// Nonconformance reads: counts (the queues) · dashboard · options (members, items, inspections, vocabularies, reports).
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return qualityRead(request, async (client, context) => {
    switch (kind) {
      case "counts": return { counts: await getNonconformanceCounts(client, context) };
      case "dashboard": return getNonconformanceDashboard(client, context);
      case "options": return listNonconformanceOptions(client, context);
      default: throw new HttpError(404, "Unknown nonconformance view.");
    }
  }, "quality.nonconformance.view");
}
