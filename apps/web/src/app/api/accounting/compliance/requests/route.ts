import { createComplianceRequest, listComplianceRequests } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function GET(request: Request) { try { const { context } = await accountingSession(); const filters = Object.fromEntries(new URL(request.url).searchParams.entries()); return ok({ requests: await tenantTransaction(context.organizationId, (client) => listComplianceRequests(client, context, filters)) }); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
export async function POST(request: Request) { try { assertSameOrigin(request); const { context } = await accountingSession(true); const input = await readJson(request) as Record<string, unknown>; return ok({ request: await tenantTransaction(context.organizationId, (client) => createComplianceRequest(client, context, input)) }, 201); } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } } }
