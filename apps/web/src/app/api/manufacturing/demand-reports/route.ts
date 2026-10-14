import { getDemandReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Demand reports (?kind=traceability|delivery-risk|excess-production|cancelled-with-orders|exceptions|by-customer).
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") || "traceability";
  return manufacturingRead(request, async (client, context) => ({ rows: await getDemandReport(client, context, kind) }));
}
