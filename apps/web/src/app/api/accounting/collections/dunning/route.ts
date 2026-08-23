import { listDunningRuns, runDunning } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { dunningSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET() {
  try { const { context } = await accountingSession(); return ok({ runs: await tenantTransaction(context.organizationId, (client) => listDunningRuns(client, context)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = dunningSchema.parse(await readJson(request)); return ok({ run: await tenantTransaction(context.organizationId, (client) => runDunning(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
