import { listSalesPass1CrossModuleOptions } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
import { procurementContext } from "@/modules/procurement";
export async function GET() {
  try {
    const { session, context } = await salesSession();
    const options = await tenantTransaction(context.organizationId, (client) =>
      listSalesPass1CrossModuleOptions(client, context, procurementContext(session)),
    );
    return ok({ options });
  } catch (error) { return errorResponse(error); }
}
