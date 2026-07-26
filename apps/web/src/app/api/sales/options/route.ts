import { getSalesOptions } from "@vercent/api";
import { errorResponse, ok } from "@/lib/http";
import { rethrowSalesError } from "@/lib/sales";
import { salesSession, tenantTransaction } from "@/lib/sales-route";
export async function GET(request: Request) { try { const { context } = await salesSession(); const opportunityId = new URL(request.url).searchParams.get("opportunityId"); const options = await tenantTransaction(context.organizationId, (client) => getSalesOptions(client, context, opportunityId)); return ok({ options }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
