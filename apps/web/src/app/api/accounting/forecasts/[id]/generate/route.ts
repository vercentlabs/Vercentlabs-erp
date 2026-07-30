import { generateCashForecast } from "@vercentlabs/api";

import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const input = await readJson(request) as Record<string, unknown>;
    const forecast = await tenantTransaction(context.organizationId, async (client) => {
      const generated = await generateCashForecast(client, context, id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "accounting.cash_forecast.generated",
        entityType: "accounting_cash_forecast",
        entityId: id,
        afterData: generated,
        request,
        client,
      });
      return generated;
    });
    return ok({ forecast });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
