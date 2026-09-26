import { z } from "zod";

import { setPosCartLineTracking } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// F295 -- lets the cashier set/change the batch or serial number on an
// already-added cart line. Validation against the real
// tenant.stock_batches/stock_serials rows happens once, authoritatively,
// in Stock's own postStockMovement at sale completion, not here -- this
// endpoint only records what the cashier scanned/typed.
const trackingSchema = z.object({
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await context.params;
    const input = trackingSchema.parse(await readJson(request));
    const result = await setPosCartLineTracking(client, posContext(session), id, lineId, input);
    return ok({ cart: result });
  });
}
