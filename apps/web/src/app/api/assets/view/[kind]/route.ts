import {
  getAssetRepairHistory,
  getAssetSettings,
  getAssetWorkOrder,
  listAssetAssignments,
  listAssetDisposals,
  listAssetOptions,
  listAssetWorkOrders,
  listMaintenancePlans,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsRead } from "@/features/assets/shared/route-helpers";

// One read endpoint per Assets screen, gated by assets.view (module-wide); every domain function re-checks its
// OWN permission (value figures need assets.reports.view, the audit trail assets.audit.view) and scopes a
// custodian to the assets assigned to them.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return assetsRead(
    request,
    async (client, context) => {
      switch (kind) {
        case "options":
          return { options: await listAssetOptions(client, context) };
        case "settings":
          return { settings: await getAssetSettings(client, context) };
        case "assignments":
          return {
            rows: await listAssetAssignments(client, context, {
              status: get("status"),
            }),
          };
        case "plans":
          return {
            rows: await listMaintenancePlans(client, context, {
              assetId: get("assetId"),
            }),
          };
        case "work-orders":
          return {
            rows: await listAssetWorkOrders(client, context, {
              status: get("status"),
              type: get("type"),
            }),
          };
        case "work-order":
          return {
            order: await getAssetWorkOrder(client, context, get("id") ?? ""),
          };
        case "repair-history":
          return {
            history: await getAssetRepairHistory(
              client,
              context,
              get("id") ?? "",
            ),
          };
        case "disposals":
          return {
            rows: await listAssetDisposals(client, context, {
              status: get("status"),
              group: get("group"),
            }),
          };
        default:
          throw new HttpError(404, "Unknown Assets view.");
      }
    },
    "assets.view",
  );
}
