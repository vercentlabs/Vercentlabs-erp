import { getBankStatement } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok } from "@/core/http";
export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) { try { const { context } = await accountingSession(); const { id } = await route.params; const statement = await tenantTransaction(context.organizationId, (client) => getBankStatement(client, context, id)); return ok({ statement }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
