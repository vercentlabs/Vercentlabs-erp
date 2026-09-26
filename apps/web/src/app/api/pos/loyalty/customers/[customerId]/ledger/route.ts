import { listPosCustomerLoyaltyLedger } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ customerId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const { customerId } = await context.params;
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const rows = await listPosCustomerLoyaltyLedger(client, posContext(session), customerId, { limit: limitParam ? Number(limitParam) : undefined });
    return ok({ rows });
  });
}
