import { z } from "zod";

import { listSalesCustomerPrices, upsertSalesCustomerPrice } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { salesContext } from "@/features/sales/shared/sales-context";
import { workspaceRoute } from "@/core/workspace-route";

const upsertSchema = z.object({
  partyId: z.string().uuid(),
  itemId: z.string().uuid(),
  priceListId: z.string().uuid().optional().nullable(),
  minimumQuantity: z.number().min(0).optional(),
  fixedRate: z.number().min(0),
  validFrom: z.string().date().optional().nullable(),
  validTo: z.string().date().optional().nullable(),
  reason: z.string().trim().min(1).max(2000),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.view" }, async ({ client, session }) => {
    const params = new URL(request.url).searchParams;
    const result = await listSalesCustomerPrices(client, salesContext(session), {
      partyId: params.get("partyId") || undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      offset: params.get("offset") ? Number(params.get("offset")) : undefined,
    });
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const input = upsertSchema.parse(await readJson(request));
    const rule = await upsertSalesCustomerPrice(client, salesContext(session), input);
    return ok({ rule }, 201);
  });
}
