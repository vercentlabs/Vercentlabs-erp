import { getPosCustomerLoyaltyBalance } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ customerId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const { customerId } = await context.params;
    const balance = await getPosCustomerLoyaltyBalance(client, posContext(session), customerId);
    return ok({ balance });
  });
}
