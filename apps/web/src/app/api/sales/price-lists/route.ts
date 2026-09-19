import { z } from "zod";

import { assertSameOriginOrMobile, createSalesPriceList, listSalesPriceLists } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";

const createSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  currencyCode: z.string().trim().length(3).optional(),
  taxInclusive: z.boolean().optional(),
  validFrom: z.string().date().optional().nullable(),
  validTo: z.string().date().optional().nullable(),
});

export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.view");
      return listSalesPriceLists(client, salesContext(session));
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
    const input = createSchema.parse(await readJson(request));
    const priceList = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.settings.manage", { mutation: true });
      return createSalesPriceList(client, salesContext(session), input);
    });
    return ok({ priceList }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
