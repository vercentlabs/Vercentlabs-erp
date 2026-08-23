import { getSalesReport } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
export async function GET(_request: Request, route: { params: Promise<{ report: string }> }) { try { const { context } = await salesSession(); const { report } = await route.params; const rows = await tenantTransaction(context.organizationId, (client) => getSalesReport(client, context, report)); return ok({ rows }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
