import { createCustomerReceipt } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = await readJson(request) as Record<string, unknown>; const receipt = await tenantTransaction(context.organizationId, (client) => createCustomerReceipt(client, context, input)); return ok({ receipt }, 201); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
