import {
  accrueSalesCommission,
  createSalesCommissionRule,
  createSalesDropShipWithSupplierValidation,
  listSalesPass1Operations,
  recordSalesAdvancePayment,
  requestSalesCreditAdjustment,
  upsertSalesPriceListItem,
  upsertSalesCustomerPrice,
  checkSalesOrderLineAvailability,
  reserveSalesOrderLineFromStock,
} from "@vercentlabs/api";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { salesSession, tenantTransaction } from "@/modules/sales/server";
import { stockContext } from "@/modules/stock";
import { procurementContext } from "@/modules/procurement";

export async function GET(request: Request) {
  try {
    const { context } = await salesSession();
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 250)
      throw new HttpError(400, "limit must be an integer between 1 and 250.");
    const rows = await tenantTransaction(context.organizationId, (client) =>
      listSalesPass1Operations(client, context, { kind: url.searchParams.get("kind") || "advances", limit }),
    );
    return ok({ rows });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, context } = await salesSession(true);
    const rawBody = await readJson(request);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody))
      throw new HttpError(400, "Sales operation body must be a JSON object.");
    const body = rawBody as Record<string, unknown>;
    const action = String(body.action || "");
    const rawInput = body.input;
    if (rawInput !== undefined && (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)))
      throw new HttpError(400, "Sales operation input must be a JSON object.");
    const input = (rawInput || {}) as Record<string, unknown>;
    const record = await tenantTransaction(context.organizationId, async (client) => {
      let result: unknown;
      if (action === "check-availability") return checkSalesOrderLineAvailability(client, context, stockContext(session), input);
      if (action === "reserve-stock") result = await reserveSalesOrderLineFromStock(client, context, stockContext(session), input);
      else if (action === "record-advance") result = await recordSalesAdvancePayment(client, context, input);
      else if (action === "request-adjustment") result = await requestSalesCreditAdjustment(client, context, input);
      else if (action === "create-drop-ship") result = await createSalesDropShipWithSupplierValidation(client, context, procurementContext(session), input);
      else if (action === "create-commission-rule") result = await createSalesCommissionRule(client, context, input);
      else if (action === "accrue-commission") result = await accrueSalesCommission(client, context, input);
      else if (action === "upsert-price-list-item") result = await upsertSalesPriceListItem(client, context, input);
      else if (action === "upsert-customer-price") result = await upsertSalesCustomerPrice(client, context, input);
      else throw new HttpError(400, "Unknown Sales operation action.");
      const recordLike = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const reservation = recordLike.reservation && typeof recordLike.reservation === "object" ? recordLike.reservation as Record<string, unknown> : {};
      const nestedRecord = recordLike.record && typeof recordLike.record === "object" ? recordLike.record as Record<string, unknown> : {};
      const entityId = String(reservation.id || recordLike.id || nestedRecord.id || "") || null;
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `sales.pass1.${action.replaceAll("-", "_")}`, entityType: action === "reserve-stock" ? "stock_reservation" : "sales_operation", entityId, metadata: { action, salesOrderId: input.salesOrderId || null }, request, client });
      return result;
    });
    return ok({ record }, 201);
  } catch (error) { return errorResponse(error); }
}
