import { explodeBom, getBom, getCapacityPlan, getEfficiencyReport, getProductionCostReport, getProductionDashboard, getProductionSummary, getStandardCost, getVarianceReport, getYieldReport, getDowntimeSummary, listDowntime, listInspections, listSubcontractJobs, listTimeEntries, getMaterialAvailability, getMrpRun, listMrpRuns, getManufacturingSettings, getProductionOrder, getRouting, getWipReport, listJobCards, listMaterialReservations, listProductionOrders, listProductionPostings, listScrapRecords, listBoms, listCalendarExceptions, listCalendars, listEngineeringChanges, listManufacturingOptions, listRoutings, listShifts, listWorkCenters, whereUsed } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One read endpoint per Manufacturing screen. Each is gated by manufacturing.view (module-wide) and
// the domain function re-checks it; cost and rate fields are stripped server-side without
// manufacturing.costing.view.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  // "days" is a look-back window ending today; explicit from/to win.
  const days = Math.min(Math.max(Math.trunc(Number(q.get("days") ?? 30)) || 30, 1), 730);
  const window = { to: get("to") ?? new Date().toISOString().slice(0, 10), from: get("from") ?? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) };
  return manufacturingRead(async (client, context) => {
    switch (kind) {
      case "options":
        return { options: await listManufacturingOptions(client, context) };
      case "boms":
        return { rows: await listBoms(client, context, { status: get("status"), itemId: get("itemId") }) };
      case "bom":
        return { bom: await getBom(client, context, get("id") ?? "") };
      case "explode":
        return { explosion: await explodeBom(client, context, { bomId: get("bomId"), itemId: get("itemId"), quantity: get("quantity") ?? 1, asOf: get("asOf") }) };
      case "where-used":
        return { rows: (await whereUsed(client, context, { itemId: get("itemId") })).map((row, index) => ({ id: `${index}:${String(row.bomId)}`, ...row })) };
      case "changes":
        return { rows: await listEngineeringChanges(client, context, { status: get("status") }) };
      case "work-centers":
        return { rows: await listWorkCenters(client, context) };
      case "calendars":
        return { rows: await listCalendars(client, context) };
      case "shifts":
        return { rows: await listShifts(client, context) };
      case "calendar-exceptions":
        return { rows: await listCalendarExceptions(client, context) };
      case "routings":
        return { rows: await listRoutings(client, context, { status: get("status") }) };
      case "routing":
        return { routing: await getRouting(client, context, get("id") ?? "") };
      case "capacity":
        return { capacity: await getCapacityPlan(client, context, { from: get("from"), days: get("days") }) };
      case "orders":
        return { rows: await listProductionOrders(client, context, { status: get("status"), sourceType: get("sourceType") }) };
      case "order":
        return { order: await getProductionOrder(client, context, get("id") ?? "") };
      case "job-cards":
        return { rows: await listJobCards(client, context, { status: get("status"), workCenterId: get("workCenterId") }) };
      case "wip":
        return { rows: await getWipReport(client, context) };
      case "reservations":
        return { rows: await listMaterialReservations(client, context) };
      case "postings":
        return { rows: await listProductionPostings(client, context, { types: get("types") }) };
      case "scrap":
        return { rows: await listScrapRecords(client, context) };
      case "settings":
        return { settings: await getManufacturingSettings(client, context) };
      case "mrp-runs":
        return { rows: await listMrpRuns(client, context) };
      case "mrp-run":
        return { run: await getMrpRun(client, context, get("id") ?? "") };
      case "material-availability":
        return { availability: await getMaterialAvailability(client, context, { itemId: get("itemId"), bomId: get("bomId"), quantity: get("quantity") ?? 1 }) };
      case "time-entries":
        return { rows: await listTimeEntries(client, context, { workOrderId: get("workOrderId") }) };
      case "inspections":
        return { rows: await listInspections(client, context) };
      case "downtime":
        return { rows: await listDowntime(client, context, { openOnly: get("open") === "1" }), summary: await getDowntimeSummary(client, context, { days: get("days") ?? 30 }) };
      case "subcontract":
        return { rows: await listSubcontractJobs(client, context) };
      case "dashboard":
        return { dashboard: await getProductionDashboard(client, context) };
      case "cost-report": {
        const r = await getProductionCostReport(client, context, window);
        return { rows: r.lines.map((l) => ({ id: String(l.orderId), ...l })), totals: r.totals };
      }
      case "variance": {
        const r = await getVarianceReport(client, context, window);
        return { rows: r.lines.map((l) => ({ id: String(l.orderId), ...l })), totals: r.totals };
      }
      case "yield": {
        const r = await getYieldReport(client, context, window);
        return { rows: r.lines.map((l) => ({ id: String(l.itemId), ...l })), reasons: r.reasons, overallYield: r.overallYield };
      }
      case "efficiency": {
        const r = await getEfficiencyReport(client, context, { ...window, from: new Date(Math.max(Date.parse(window.from), Date.parse(window.to) - 59 * 86400000)).toISOString().slice(0, 10) });
        return { rows: r.centers.map((l) => ({ id: String(l.workCenterId), ...l })) };
      }
      case "summary": {
        const r = await getProductionSummary(client, context, window);
        return { rows: r.lines.map((l) => ({ id: String(l.item_code), ...l })) };
      }
      case "standard-cost":
        return { standard: await getStandardCost(client, context, { itemId: get("itemId"), quantity: get("quantity") ?? 1 }) };
      default:
        throw new HttpError(404, "Unknown manufacturing view.");
    }
  });
}
