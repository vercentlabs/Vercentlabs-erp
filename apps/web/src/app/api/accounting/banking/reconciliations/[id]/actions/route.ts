import { completeBankReconciliation, matchBankStatementLine } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const { id } = await route.params; const input = await readJson(request) as Record<string, unknown>; const action = String(input.action || ""); const result = await tenantTransaction(context.organizationId, (client) => action === "complete" ? completeBankReconciliation(client, context, id) : action === "match" ? matchBankStatementLine(client, context, id, input) : Promise.reject(new HttpError(400, "Unsupported reconciliation action."))); return ok({ result }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
