import { z } from "zod";

import { assertSameOriginOrMobile, setPosCartLineTracking } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

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
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, lineId } = await context.params;
    const input = trackingSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create");
      return setPosCartLineTracking(client, posContext(session), id, lineId, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
