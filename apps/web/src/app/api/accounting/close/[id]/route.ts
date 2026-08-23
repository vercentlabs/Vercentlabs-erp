import { getCloseRun } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok } from "@/core/http";
export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) { try { const { context } = await accountingSession(); const { id } = await route.params; const run = await tenantTransaction(context.organizationId, (client) => getCloseRun(client, context, id)); return ok({ run }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
