import { z } from "zod";

import { setPosCartLineTracking } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// The batch or serial number of a tracked cart line, as scanned or typed (or its id). Inventory checks it before it is recorded: the serial
// must be this product's, in this store's selling stock and on no other open sale; the batch must be eligible here.
const trackingSchema = z.object({
  serialNumber: z.string().trim().min(1).max(64).optional().nullable(),
  batchNumber: z.string().trim().min(1).max(64).optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; lineId: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "point-of-sale",
      permission: "pos.sale.create",
      billingWrite: true,
    },
    async ({ client, session }) => {
      const { id, lineId } = await context.params;
      const input = trackingSchema.parse(await readJson(request));
      const result = await setPosCartLineTracking(
        client,
        posContext(session),
        id,
        lineId,
        input,
      );
      return ok({ cart: result });
    },
  );
}
