import { createPreventiveMaintenancePlan, listMaintenancePlans } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET plans (?view=&assetId=) · POST create a preventive plan
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, (client, context) => listMaintenancePlans(client, context, { view: get("view"), assetId: get("assetId") }));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createPreventiveMaintenancePlan(client, context, input), 201);
}
