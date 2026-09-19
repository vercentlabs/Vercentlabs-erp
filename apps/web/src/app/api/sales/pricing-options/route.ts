import { listSalesPricingOptions } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";

export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, "sales.view");
      return listSalesPricingOptions(client, salesContext(session));
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
