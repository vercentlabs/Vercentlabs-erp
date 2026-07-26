import { getSalesOrder } from "@vercent/api";
import { errorResponse, ok } from "@/lib/http";
import { rethrowSalesError } from "@/lib/sales";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) { try { const { context } = await salesSession(); const { id } = await route.params; const order = await tenantTransaction(context.organizationId, (client) => getSalesOrder(client, context, id)); return ok({ order }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
