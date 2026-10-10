import { z } from "zod";

import { setPosCartCustomer } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const customerSchema = z.object({
  customerId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().optional(),
  // A retried request with the same key is applied once (Cart, migration 0086).
  idempotencyKey: z.string().min(8).max(100).optional(),
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
      const input = customerSchema.parse(await readJson(request));
      const result = await setPosCartCustomer(
        client,
        posContext(session),
        id,
        input,
      );
      return ok({ cart: result });
    },
  );
}
