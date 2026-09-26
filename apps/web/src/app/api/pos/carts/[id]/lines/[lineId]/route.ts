import { z } from "zod";

import { updatePosCartLineQuantity, removePosCartLine } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const quantitySchema = z.object({
  quantity: z.number().positive(),
  expectedVersion: z.number().int().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await context.params;
    const input = quantitySchema.parse(await readJson(request));
    const result = await updatePosCartLineQuantity(client, posContext(session), id, lineId, input);
    return ok({ cart: result });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const result = await removePosCartLine(client, posContext(session), id, lineId, {
      expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
    });
    return ok({ cart: result });
  });
}
