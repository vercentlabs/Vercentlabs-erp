import { createRecurringTemplate, listRecurringTemplates } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { recurringTemplateSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET(request: Request) {
  try { const { context } = await accountingSession(); const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); return ok({ templates: await tenantTransaction(context.organizationId, (client) => listRecurringTemplates(client, context, filters)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = recurringTemplateSchema.parse(await readJson(request)); return ok({ template: await tenantTransaction(context.organizationId, (client) => createRecurringTemplate(client, context, input)) }, 201); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
