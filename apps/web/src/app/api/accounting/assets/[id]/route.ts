import { getAsset } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok } from "@/lib/http";

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { context } = await accountingSession();
    const { id } = await route.params;
    const asset = await tenantTransaction(context.organizationId, (client) => getAsset(client, context, id));
    return ok({ asset });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
