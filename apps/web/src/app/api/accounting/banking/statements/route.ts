import { importBankStatement, listBankStatements } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function GET(request: Request) { try { const { context } = await accountingSession(); const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); const statements = await tenantTransaction(context.organizationId, (client) => listBankStatements(client, context, filters)); return ok({ statements }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = await readJson(request) as Record<string, unknown>; const statement = await tenantTransaction(context.organizationId, (client) => importBankStatement(client, context, input)); return ok({ statement }, 201); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
