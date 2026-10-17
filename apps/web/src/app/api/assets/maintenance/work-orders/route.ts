import { createMaintenanceWorkOrder, listMaintenanceWorkOrders } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET Work Orders (?view=&search=&assetId=&technicianUserId=) · POST create { requestId? | assetId? | asset?, title, … , idempotencyKey? }
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, (client, context) => listMaintenanceWorkOrders(client, context, { view: get("view"), search: get("search"), assetId: get("assetId"), technicianUserId: get("technicianUserId") }));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createMaintenanceWorkOrder(client, context, input), 201);
}
