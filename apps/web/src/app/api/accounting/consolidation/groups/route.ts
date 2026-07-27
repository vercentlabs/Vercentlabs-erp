import { createConsolidationGroup, listConsolidationGroups } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { consolidationGroupSchema } from "@/lib/accounting-validation";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function GET() {
  try { const { context } = await accountingSession(); return ok({ groups: await tenantTransaction(context.organizationId, (client) => listConsolidationGroups(client, context)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = consolidationGroupSchema.parse(await readJson(request)); return ok({ group: await tenantTransaction(context.organizationId, (client) => createConsolidationGroup(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
