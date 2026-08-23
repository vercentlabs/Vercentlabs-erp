import { createIntercompanyRule, listIntercompanyRules } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { intercompanyRuleSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET() {
  try { const { context } = await accountingSession(); return ok({ rules: await tenantTransaction(context.organizationId, (client) => listIntercompanyRules(client, context)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = intercompanyRuleSchema.parse(await readJson(request)); return ok({ rule: await tenantTransaction(context.organizationId, (client) => createIntercompanyRule(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
