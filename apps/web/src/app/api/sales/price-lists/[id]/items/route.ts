import { z } from "zod";

import { assertSameOriginOrMobile, listSalesPriceListItems, upsertSalesPriceListItem } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";

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
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.view");
      return listSalesPriceListItems(client, salesContext(session), id, {
        limit: params.get("limit") ? Number(params.get("limit")) : undefined,
        offset: params.get("offset") ? Number(params.get("offset")) : undefined,
      });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = upsertSchema.parse(await readJson(request));
    const item = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.settings.manage", { mutation: true });
      return upsertSalesPriceListItem(client, salesContext(session), { ...input, priceListId: id });
    });
    return ok({ item }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
