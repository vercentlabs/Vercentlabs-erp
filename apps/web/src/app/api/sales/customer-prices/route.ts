import { z } from "zod";

import { assertSameOriginOrMobile, listSalesCustomerPrices, upsertSalesCustomerPrice } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";

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
  try {
    const session = await requireWorkspace();
    const params = new URL(request.url).searchParams;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.view");
      return listSalesCustomerPrices(client, salesContext(session), {
        partyId: params.get("partyId") || undefined,
        limit: params.get("limit") ? Number(params.get("limit")) : undefined,
        offset: params.get("offset") ? Number(params.get("offset")) : undefined,
      });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = upsertSchema.parse(await readJson(request));
    const rule = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.settings.manage", { mutation: true });
      return upsertSalesCustomerPrice(client, salesContext(session), input);
    });
    return ok({ rule }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
