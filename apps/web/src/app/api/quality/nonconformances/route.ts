import { createNonconformance, listNonconformances } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation, qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Nonconformances: the queues (view, search, severity, dates) and raising an NCR by hand.
const VIEW = "quality.nonconformance.view";
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) => ({
    rows: await listNonconformances(client, context, { view: get("view"), search: get("search"), severity: get("severity"), from: get("from"), to: get("to") }),
  }), VIEW);
}
export async function POST(request: Request) {
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createNonconformance(client, context, input), 201, VIEW);
}
