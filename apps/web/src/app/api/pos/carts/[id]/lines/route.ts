import { z } from "zod";

import { addPosCartLine } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const addLineSchema = z.object({
  itemId: z.string().uuid(),
  // The unit sold (the item's sales unit when omitted) and a request key so a retry adds once (Product Search).
  uomId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().min(8).max(100).optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  priceOverride: z.boolean().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  warehouseId: z.string().uuid().optional(),
  warehouseLocationId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
  expectedVersion: z.number().int().optional(),
  // A price override needs a reason, and above the cashier's limit a supervisor approval (Cashier Permissions).
  reason: z.string().trim().max(500).optional(),
  approvalId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "point-of-sale",
      permission: "pos.sale.create",
      billingWrite: true,
    },
    async ({ client, session }) => {
      const { id } = await context.params;
      const input = addLineSchema.parse(await readJson(request));
      const result = await addPosCartLine(
        client,
        posContext(session),
        id,
        input,
      );
      return ok({ cart: result });
    },
  );
}
