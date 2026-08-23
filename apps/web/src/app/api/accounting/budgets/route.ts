import { createBudget, listBudgets } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { budgetSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET() {
  try { const { context } = await accountingSession(); return ok({ budgets: await tenantTransaction(context.organizationId, (client) => listBudgets(client, context)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = budgetSchema.parse(await readJson(request)); return ok({ budget: await tenantTransaction(context.organizationId, (client) => createBudget(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
