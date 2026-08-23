import { getAccountingOptions } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok } from "@/core/http";
export async function GET(request: Request) { try { const { context } = await accountingSession(); const companyId = new URL(request.url).searchParams.get("companyId"); const options = await tenantTransaction(context.organizationId, (client) => getAccountingOptions(client, context, companyId)); return ok({ options }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
