import { z } from "zod";

import { assertSameOriginOrMobile, addPosCartLine } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const addLineSchema = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  priceOverride: z.boolean().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  warehouseId: z.string().uuid().optional(),
  warehouseLocationId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = addLineSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return addPosCartLine(client, posContext(session), id, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
