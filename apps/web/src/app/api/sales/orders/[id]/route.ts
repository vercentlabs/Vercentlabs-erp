import { getSalesOrder } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) { try { const { context } = await salesSession(); const { id } = await route.params; const order = await tenantTransaction(context.organizationId, (client) => getSalesOrder(client, context, id)); return ok({ order }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
