import { z } from "zod";

import { updatePosCartLineQuantity, removePosCartLine } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// A quantity typed or stepped, in the line's unit (decimals only where the unit allows them); the version the cashier saw, so a stale tab
// cannot overwrite a newer bill; a request key so a retry is applied once.
const quantitySchema = z.object({
  quantity: z.union([z.number(), z.string().regex(/^-?d{1,9}(.d{1,6})?$/).transform(Number)]),
  expectedVersion: z.number().int(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export async function PATCH(
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
      const input = quantitySchema.parse(await readJson(request));
      const result = await updatePosCartLineQuantity(
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

export async function DELETE(
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
      const url = new URL(request.url);
      const expectedVersion = url.searchParams.get("expectedVersion");
      const result = await removePosCartLine(
        client,
        posContext(session),
        id,
        lineId,
        {
          expectedVersion: expectedVersion
            ? Number(expectedVersion)
            : undefined,
          idempotencyKey: url.searchParams.get("idempotencyKey")?.slice(0, 100) || undefined,
        },
      );
      return ok({ cart: result });
    },
  );
}
