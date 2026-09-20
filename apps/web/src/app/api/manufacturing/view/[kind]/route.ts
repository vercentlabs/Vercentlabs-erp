import { explodeBom, getBom, getCapacityPlan, getRouting, listBoms, listCalendarExceptions, listCalendars, listEngineeringChanges, listManufacturingOptions, listRoutings, listShifts, listWorkCenters, whereUsed } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One read endpoint per Manufacturing screen. Each is gated by manufacturing.view (module-wide) and
// the domain function re-checks it; cost and rate fields are stripped server-side without
// manufacturing.costing.view.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
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
      default:
        throw new HttpError(404, "Unknown manufacturing view.");
    }
  });
}
