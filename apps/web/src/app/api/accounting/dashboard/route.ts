import { getAccountingDashboard } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok } from "@/core/http";
export async function GET(request: Request) { try { const { context } = await accountingSession(); const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); const dashboard = await tenantTransaction(context.organizationId, (client) => getAccountingDashboard(client, context, filters)); return ok({ dashboard }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
