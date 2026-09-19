import { z } from "zod";

import { assertSameOriginOrMobile, updatePosCartLineQuantity, removePosCartLine } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const quantitySchema = z.object({
  quantity: z.number().positive(),
  expectedVersion: z.number().int().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, lineId } = await context.params;
    const input = quantitySchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return updatePosCartLineQuantity(client, posContext(session), id, lineId, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, lineId } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return removePosCartLine(client, posContext(session), id, lineId, {
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
      });
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
