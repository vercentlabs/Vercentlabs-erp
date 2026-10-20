import { listIncomingInspections, requestFinalInspection } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation, qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Final Inspection: the queues (view, search, production order, item, dates) and a manual request for reported production output.
const VIEW = "quality.final.view";
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) => ({
    rows: await listIncomingInspections(client, context, { type: "final", view: get("view"), search: get("search"), orderId: get("orderId"), itemId: get("itemId"), from: get("from"), to: get("to") }),
  }), VIEW);
}
export async function POST(request: Request) {
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => requestFinalInspection(client, context, input), 201, VIEW);
}
