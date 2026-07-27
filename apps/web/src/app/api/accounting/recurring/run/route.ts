import { runDueRecurringTemplates } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const body = await readJson(request) as { runDate?: string }; const executions = await tenantTransaction(context.organizationId, (client) => runDueRecurringTemplates(client, context, body.runDate || null)); return ok({ executions }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
