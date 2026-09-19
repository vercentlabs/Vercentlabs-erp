import { assertSameOriginOrMobile, deactivateSalesPriceListItem } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const item = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.settings.manage", { mutation: true });
      return deactivateSalesPriceListItem(client, salesContext(session), id);
    });
    return ok({ item });
  } catch (error) {
    return errorResponse(error);
  }
}
