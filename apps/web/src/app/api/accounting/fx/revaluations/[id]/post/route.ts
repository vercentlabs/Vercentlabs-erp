import { postRevaluation } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const { context } = await accountingSession(true); const { id } = await route.params; return ok({ run: await tenantTransaction(context.organizationId, (client) => postRevaluation(client, context, id)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
