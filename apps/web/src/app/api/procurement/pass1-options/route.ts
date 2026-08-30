import { listProcurementPass1Options } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
export async function GET() {
  try {
    const { context } = await procurementSession();
    return ok({ options: await tenantTransaction(context.organizationId, (client) => listProcurementPass1Options(client, context)) });
  } catch (error) { return errorResponse(error); }
}
