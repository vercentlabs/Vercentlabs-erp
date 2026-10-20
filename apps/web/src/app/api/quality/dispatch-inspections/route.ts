import { listIncomingInspections, requestDispatchInspection } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation, qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Pre-dispatch inspection: the queues (view, search, delivery, sales order, item, dates) and a manual request for a delivery line.
const VIEW = "quality.dispatch.view";
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) => ({
    rows: await listIncomingInspections(client, context, { type: "pre_dispatch", view: get("view"), search: get("search"), deliveryId: get("deliveryId"), salesOrderId: get("salesOrderId"), itemId: get("itemId"), from: get("from"), to: get("to") }),
  }), VIEW);
}
export async function POST(request: Request) {
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => requestDispatchInspection(client, context, input), 201, VIEW);
}
