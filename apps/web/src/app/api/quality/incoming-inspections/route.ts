import { createManualIncomingInspection, listIncomingInspections } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation, qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Incoming Inspection: the queues (view, search, supplier, item, dates) and a manual inspection of a goods receipt line.
const VIEW = "quality.incoming.view";
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) => ({
    rows: await listIncomingInspections(client, context, { view: get("view"), search: get("search"), supplierId: get("supplierId"), itemId: get("itemId"), from: get("from"), to: get("to") }),
  }), VIEW);
}
export async function POST(request: Request) {
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createManualIncomingInspection(client, context, input), 201, VIEW);
}
