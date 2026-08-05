import { getStockDashboard } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/lib/stock-route";
import { errorResponse, ok } from "@/lib/http";
export async function GET() {
  try {
    const { context } = await stockSession();
    return ok({
      dashboard: await tenantTransaction(context.organizationId, (c) =>
        getStockDashboard(c, context),
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
