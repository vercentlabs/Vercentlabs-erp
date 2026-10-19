import { z } from "zod";

import { cancelEwayBill, updateEwayBillVehicle } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// PATCH { vehicleNumber, reason, transportMode } updates Part B; DELETE-like cancel is POST { cancel: true, reason, remarks }.
const vehicleSchema = z.object({ vehicleNumber: z.string().min(4).max(20), reason: z.enum(["first_time", "breakdown", "transhipment", "others"]).optional(),
  transportMode: z.enum(["road", "rail", "air", "ship"]).optional(), fromPlace: z.string().max(60).optional() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { billingWrite: true, action: "compliance.eway_bill.vehicle", auditDenial: true }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await updateEwayBillVehicle(client, session, id, vehicleSchema.parse(await readJson(request))));
  });
}

const cancelSchema = z.object({ reason: z.enum(["duplicate", "order_cancelled", "data_entry_mistake", "others"]), remarks: z.string().max(100).optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { billingWrite: true, action: "compliance.eway_bill.cancel", auditDenial: true }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await cancelEwayBill(client, session, id, cancelSchema.parse(await readJson(request))));
  });
}
