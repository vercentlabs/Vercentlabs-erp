import { z } from "zod";

import { ewayTransportDefaults, generateEwayBill, getEwayBill, gspConfigured } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// e-way bills for sales invoices, deliveries, transfers and purchase returns: GET ?sourceType=&sourceId= (the latest), POST to generate.
const SOURCES = ["sales_delivery", "stock_transfer", "purchase_return", "sales_invoice", "sales_challan"] as const;
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "compliance.eway_bill.view" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const sourceType = url.searchParams.get("sourceType") ?? "";
    const known = SOURCES.includes(sourceType as (typeof SOURCES)[number]);
    const sourceId = url.searchParams.get("sourceId") ?? "";
    return ok({ ewayBill: known ? await getEwayBill(client, session, sourceType, sourceId) : null,
      defaults: known ? await ewayTransportDefaults(client, session, sourceType, sourceId) : null, configured: gspConfigured(process.env) });
  });
}

const schema = z.object({
  sourceType: z.enum(SOURCES),
  sourceId: z.string().uuid(),
  transportMode: z.enum(["road", "rail", "air", "ship"]).optional(),
  vehicleNumber: z.string().max(20).optional(),
  transporterId: z.string().max(20).optional(),
  transporterDocument: z.string().max(30).optional(),
  distanceKm: z.number().int().min(0).max(4000).optional(),
  voluntary: z.boolean().optional(),
});
export async function POST(request: Request) {
  return workspaceRoute(request, { billingWrite: true, action: "compliance.eway_bill.generate", auditDenial: true }, async ({ client, session }) => {
    const { sourceType, sourceId, ...input } = schema.parse(await readJson(request));
    return ok(await generateEwayBill(client, session, sourceType, sourceId, input));
  });
}
