import { lookupPointOfSaleBarcode } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ storeId: string; code: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const { storeId, code } = await context.params;
    const result = await lookupPointOfSaleBarcode(client, posContext(session), storeId, decodeURIComponent(code));
    return ok({ product: result });
  });
}
