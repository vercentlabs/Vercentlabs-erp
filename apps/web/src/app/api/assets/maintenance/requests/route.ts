import { createMaintenanceRequest, listMaintenanceRequests } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET requests (?view=&search=&assetId=) · POST report a problem { assetId | asset, description, symptoms?, safetyConcern?, priority?, observedCondition?, distinctIssue?, idempotencyKey? }
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, (client, context) => listMaintenanceRequests(client, context, { view: get("view"), search: get("search"), assetId: get("assetId") }));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createMaintenanceRequest(client, context, input), 201);
}
