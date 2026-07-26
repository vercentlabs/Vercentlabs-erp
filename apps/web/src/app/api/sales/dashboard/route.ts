import { getSalesDashboard } from "@vercentlabs/api";
import { errorResponse, ok } from "@/lib/http";
import { rethrowSalesError } from "@/lib/sales";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
export async function GET() { try { const { context } = await salesSession(); const dashboard = await tenantTransaction(context.organizationId, (client) => getSalesDashboard(client, context)); return ok({ dashboard }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
