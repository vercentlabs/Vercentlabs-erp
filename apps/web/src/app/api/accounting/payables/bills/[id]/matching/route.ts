import { evaluateVendorBillMatch, getVendorBillMatch, overrideVendorBillMatch } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  try { const { context } = await accountingSession(); const { id } = await route.params; return ok({ match: await tenantTransaction(context.organizationId, (client) => getVendorBillMatch(client, context, id)) }); }
  catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { context } = await accountingSession(true); const { id } = await route.params;
    const input = await readJson(request) as Record<string, unknown>; const action = String(input.action || "evaluate");
    const result = await tenantTransaction(context.organizationId, (client) => action === "evaluate"
      ? evaluateVendorBillMatch(client, context, id, input)
      : action === "override" ? overrideVendorBillMatch(client, context, id, input)
        : Promise.reject(new HttpError(400, "Unsupported matching action.")));
    return ok({ result });
  } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
