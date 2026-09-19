import { assertSameOriginOrMobile, deactivateSalesPricingRule } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rule = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.settings.manage", { mutation: true });
      return deactivateSalesPricingRule(client, salesContext(session), id);
    });
    return ok({ rule });
  } catch (error) {
    return errorResponse(error);
  }
}
