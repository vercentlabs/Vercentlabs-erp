import { getAccountingReport } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok } from "@/core/http";
export async function GET(request: Request, route: { params: Promise<{ report: string }> }) { try { const { context } = await accountingSession(); const { report } = await route.params; const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); const rows = await tenantTransaction(context.organizationId, (client) => getAccountingReport(client, context, report, filters)); return ok({ rows, report }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
