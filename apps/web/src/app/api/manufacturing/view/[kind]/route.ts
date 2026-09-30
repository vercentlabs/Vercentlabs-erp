import {
  explodeBom,
  getBom,
  getProductionCostReport,
  getProductionDashboard,
  getStandardCost,
  getVarianceReport,
  listManufacturingInspections,
  getMaterialAvailability,
  getManufacturingSettings,
  getProductionOrder,
  listMaterialReservations,
  listProductionOrders,
  listProductionPostings,
  listScrapRecords,
  listBoms,
  listManufacturingOptions,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One read endpoint per Manufacturing screen. Each is gated by manufacturing.view (module-wide) and
// the domain function re-checks it; cost and rate fields are stripped server-side without
// manufacturing.costing.view.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  // "days" is a look-back window ending today; explicit from/to win.
  const days = Math.min(
    Math.max(Math.trunc(Number(q.get("days") ?? 30)) || 30, 1),
    730,
  );
  const window = {
    to: get("to") ?? new Date().toISOString().slice(0, 10),
    from:
      get("from") ??
      new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
  };
  return manufacturingRead(request, async (client, context) => {
    switch (kind) {
      case "options":
        return { options: await listManufacturingOptions(client, context) };
      case "boms":
        return {
          rows: await listBoms(client, context, {
            status: get("status"),
            itemId: get("itemId"),
          }),
        };
      case "bom":
        return { bom: await getBom(client, context, get("id") ?? "") };
      case "explode":
        return {
          explosion: await explodeBom(client, context, {
            bomId: get("bomId"),
            itemId: get("itemId"),
            quantity: get("quantity") ?? 1,
            asOf: get("asOf"),
          }),
        };
      case "orders":
        return {
          rows: await listProductionOrders(client, context, {
            status: get("status"),
            sourceType: get("sourceType"),
          }),
        };
      case "order":
        return {
          order: await getProductionOrder(client, context, get("id") ?? ""),
        };
      case "reservations":
        return { rows: await listMaterialReservations(client, context) };
      case "postings":
        return {
          rows: await listProductionPostings(client, context, {
            types: get("types"),
          }),
        };
      case "scrap":
        return { rows: await listScrapRecords(client, context) };
      case "settings":
        return { settings: await getManufacturingSettings(client, context) };
      case "material-availability":
        return {
          availability: await getMaterialAvailability(client, context, {
            itemId: get("itemId"),
            bomId: get("bomId"),
            quantity: get("quantity") ?? 1,
          }),
        };
      case "inspections":
        return { rows: await listManufacturingInspections(client, context) };
      case "dashboard":
        return { dashboard: await getProductionDashboard(client, context) };
      case "cost-report": {
        const r = await getProductionCostReport(client, context, window);
        return {
          rows: r.lines.map((l) => ({ id: String(l.orderId), ...l })),
          totals: r.totals,
        };
      }
      case "variance": {
        const r = await getVarianceReport(client, context, window);
        return {
          rows: r.lines.map((l) => ({ id: String(l.orderId), ...l })),
          totals: r.totals,
        };
      }
      case "standard-cost":
        return {
          standard: await getStandardCost(client, context, {
            itemId: get("itemId"),
            quantity: get("quantity") ?? 1,
          }),
        };
      default:
        throw new HttpError(404, "Unknown manufacturing view.");
    }
  });
}
