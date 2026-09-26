import { z } from "zod";

import { createPosCart } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const createCartSchema = z.object({
  storeId: z.string().uuid(),
  terminalId: z.string().uuid(),
  shiftId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const input = createCartSchema.parse(await readJson(request));
    const result = await createPosCart(client, posContext(session), input);
    return ok({ cart: result }, 201);
  });
}
