import { updateCloseTask } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function PATCH(request: Request, route: { params: Promise<{ id: string; taskId: string }> }) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const { id, taskId } = await route.params; const input = await readJson(request) as Record<string, unknown>; const run = await tenantTransaction(context.organizationId, (client) => updateCloseTask(client, context, id, taskId, input)); return ok({ run }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
