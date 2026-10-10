import { resumePosCart } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

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
      const body = (await readJson(request).catch(() => ({}))) as { idempotencyKey?: unknown };
      const result = await resumePosCart(client, posContext(session), id, { idempotencyKey: typeof body?.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 100) : undefined });
      return ok({ cart: result });
    },
  );
}
