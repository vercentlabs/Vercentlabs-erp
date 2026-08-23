import { createConsolidationGroup, listConsolidationGroups } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { consolidationGroupSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET() {
  try { const { context } = await accountingSession(); return ok({ groups: await tenantTransaction(context.organizationId, (client) => listConsolidationGroups(client, context)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = consolidationGroupSchema.parse(await readJson(request)); return ok({ group: await tenantTransaction(context.organizationId, (client) => createConsolidationGroup(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
