import { createCloseRun, listCloseRuns } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function GET() { try { const { context } = await accountingSession(); const runs = await tenantTransaction(context.organizationId, (client) => listCloseRuns(client, context)); return ok({ runs }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = await readJson(request) as Record<string, unknown>; const run = await tenantTransaction(context.organizationId, (client) => createCloseRun(client, context, input)); return ok({ run }, 201); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
