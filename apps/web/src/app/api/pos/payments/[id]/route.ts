import { getPosPaymentStatus } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// Polled by the checkout UI while a non-cash leg is pending/authorized --
// there is no client-side "it succeeded," only whatever the server reports
// here, which only ever reflects an adapter's own synchronous response or
// a verified webhook (see features/payments.js).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.view" }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await getPosPaymentStatus(client, posContext(session), id);
    return ok({ payment: result });
  });
}
