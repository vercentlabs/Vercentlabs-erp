import {
  getQualitySettings,
  getQualityKpiDashboard,
  listQualityOptions,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// One read endpoint per Quality screen. Each is gated by quality.view (module-wide) and the domain
// function re-checks its OWN permission.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  return qualityRead(
    request,
    async (client, context) => {
      switch (kind) {
        case "options":
          return { options: await listQualityOptions(client, context) };
        case "settings":
          return { settings: await getQualitySettings(client, context) };
        case "dashboard":
          return { dashboard: await getQualityKpiDashboard(client, context) };
        default:
          throw new HttpError(404, "Unknown Quality view.");
      }
    },
    "quality.view",
  );
}
