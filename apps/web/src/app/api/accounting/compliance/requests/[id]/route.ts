import { updateComplianceRequest } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const { id } = await route.params; const input = await readJson(request) as Record<string, unknown>; return ok({ request: await tenantTransaction(context.organizationId, (client) => updateComplianceRequest(client, context, id, input)) }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
