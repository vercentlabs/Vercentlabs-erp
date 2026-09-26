import { z } from "zod";

import { createSalesPriceList, listSalesPriceLists } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { salesContext } from "@/features/sales/shared/sales-context";
import { workspaceRoute } from "@/core/workspace-route";

const createSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  currencyCode: z.string().trim().length(3).optional(),
  taxInclusive: z.boolean().optional(),
  validFrom: z.string().date().optional().nullable(),
  validTo: z.string().date().optional().nullable(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.view" }, async ({ client, session }) => {
    const result = await listSalesPriceLists(client, salesContext(session));
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const input = createSchema.parse(await readJson(request));
    const priceList = await createSalesPriceList(client, salesContext(session), input);
    return ok({ priceList }, 201);
  });
}
