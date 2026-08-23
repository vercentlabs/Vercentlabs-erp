import { getSalesOptions } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
export async function GET(request: Request) { try { const { context } = await salesSession(); const opportunityId = new URL(request.url).searchParams.get("opportunityId"); const options = await tenantTransaction(context.organizationId, (client) => getSalesOptions(client, context, opportunityId)); return ok({ options }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
