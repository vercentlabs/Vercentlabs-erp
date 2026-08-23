import { generateCashForecast } from "@vercentlabs/api";

import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

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
