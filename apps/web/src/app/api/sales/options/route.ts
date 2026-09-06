import { getSalesOptions } from "@vercentlabs/api";
import { errorResponse, ok } from "@/core/http";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
export async function GET(request: Request) { try { const { context } = await salesSession(); const searchParams = new URL(request.url).searchParams; const opportunityId = searchParams.get("opportunityId"); const partyId = searchParams.get("partyId"); const options = await tenantTransaction(context.organizationId, (client) => getSalesOptions(client, context, opportunityId, partyId)); return ok({ options }); } catch (error) { try { rethrowSalesError(error); } catch (mapped) { return errorResponse(mapped); } } }
