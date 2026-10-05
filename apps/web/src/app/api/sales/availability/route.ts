import { z } from "zod";

import { checkItemsAvailability, checkWarehouseAvailability } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesRead } from "@/features/sales/shared/route-helpers";
import { salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

// GET ?itemId= — a product's stock in every warehouse that fulfils sales, with the total.
export async function GET(request: Request) {
  const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
  return salesRead(request, "sales.availability.view", async (client, context) => ({ availability: await checkWarehouseAvailability(client, context, itemId) }));
}

// POST — several products at once, for a quotation or an order being prepared.
// A read sent as a body: informational, nothing is reserved or written.
const schema = z.object({
  lines: z.array(z.object({ itemId: z.string().uuid(), warehouseId: z.string().uuid().nullish(), quantity: z.union([z.number(), z.string()]), uomId: z.string().uuid().nullish() })).min(1).max(500),
});
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.availability.view" }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    return ok(toWire({ availability: await checkItemsAvailability(client, salesContext(session), input) }) as Record<string, unknown>);
  });
}
