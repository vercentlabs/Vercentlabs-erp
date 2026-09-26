import { z } from "zod";

import { cancelPosCart } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = cancelSchema.parse(await readJson(request).catch(() => ({})));
    const result = await cancelPosCart(client, posContext(session), id, input);
    return ok({ cart: result });
  });
}
