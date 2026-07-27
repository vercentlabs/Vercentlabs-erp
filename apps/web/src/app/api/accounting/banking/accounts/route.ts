import { createBankAccount, listBankAccounts } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function GET() { try { const { context } = await accountingSession(); const accounts = await tenantTransaction(context.organizationId, (client) => listBankAccounts(client, context)); return ok({ accounts }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = await readJson(request) as Record<string, unknown>; const account = await tenantTransaction(context.organizationId, (client) => createBankAccount(client, context, input)); return ok({ account }, 201); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
