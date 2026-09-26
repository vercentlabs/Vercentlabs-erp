import { z } from "zod";

import { listSalesPriceListItems, upsertSalesPriceListItem } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { salesContext } from "@/features/sales/shared/sales-context";
import { workspaceRoute } from "@/core/workspace-route";

const upsertSchema = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  uomId: z.string().uuid().optional().nullable(),
  minimumQuantity: z.number().positive().optional(),
  rate: z.number().min(0),
  validFrom: z.string().date().optional().nullable(),
  validTo: z.string().date().optional().nullable(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "sales", permission: "sales.view" }, async ({ client, session }) => {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const result = await listSalesPriceListItems(client, salesContext(session), id, {
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      offset: params.get("offset") ? Number(params.get("offset")) : undefined,
    });
    return ok(result);
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "sales", permission: "sales.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = upsertSchema.parse(await readJson(request));
    const item = await upsertSalesPriceListItem(client, salesContext(session), { ...input, priceListId: id });
    return ok({ item }, 201);
  });
}
