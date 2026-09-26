import { deactivateSalesPriceListItem } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { salesContext } from "@/features/sales/shared/sales-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "sales", permission: "sales.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const item = await deactivateSalesPriceListItem(client, salesContext(session), id);
    return ok({ item });
  });
}
