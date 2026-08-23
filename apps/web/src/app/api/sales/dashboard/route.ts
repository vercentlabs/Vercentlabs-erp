import { getSalesDashboard } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
export async function GET() { try { const { context } = await salesSession(); const dashboard = await tenantTransaction(context.organizationId, (client) => getSalesDashboard(client, context)); return ok({ dashboard }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
