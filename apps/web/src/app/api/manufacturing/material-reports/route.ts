import { getMaterialReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a material availability report (?kind=readiness|demand-by-item|warehouse-shortages|reservation-coverage|issued-vs-required|incoming|
// subassembly-shortages|aging). Checks manufacturing.material.view in the domain.
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") || "readiness";
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getMaterialReport(client, context, kind) }));
}
