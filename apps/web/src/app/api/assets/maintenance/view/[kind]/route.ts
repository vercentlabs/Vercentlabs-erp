import { getMaintenanceAudit, getMaintenanceDue, getMaintenanceExceptions, getMaintenanceOptions, getMaintenanceReport, reconcileMaintenanceSources } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET options · due (?days=) · exceptions · report (?kind=) · audit (?assetId=) · reconciliation
type Params = { params: Promise<{ kind: string }> };
export async function GET(request: Request, ctx: Params) {
  const { kind } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (kind) {
      case "options": return getMaintenanceOptions(client, context);
      case "due": return getMaintenanceDue(client, context, { days: get("days") });
      case "exceptions": return getMaintenanceExceptions(client, context);
      case "report": return getMaintenanceReport(client, context, get("kind") ?? "open-requests");
      case "audit": return getMaintenanceAudit(client, context, { assetId: get("assetId") });
      case "reconciliation": return reconcileMaintenanceSources(client, context);
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
