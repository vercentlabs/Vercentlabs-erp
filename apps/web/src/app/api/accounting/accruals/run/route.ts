import { runDueAccruals } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = await readJson(request) as { runDate?: string; scheduleId?: string }; return ok({ recognitions: await tenantTransaction(context.organizationId, (client) => runDueAccruals(client, context, input)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
