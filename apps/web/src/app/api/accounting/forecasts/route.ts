import { createCashForecastScenario, listCashForecasts } from "@vercentlabs/api";

import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
    return ok({
      forecasts: await tenantTransaction(context.organizationId, (client) =>
        listCashForecasts(client, context, filters),
      ),
    });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const input = await readJson(request) as Record<string, unknown>;
    const forecast = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createCashForecastScenario(client, context, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "accounting.cash_forecast.created",
        entityType: "accounting_cash_forecast",
        entityId: typeof created.id === "string" ? created.id : undefined,
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ forecast }, 201);
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
