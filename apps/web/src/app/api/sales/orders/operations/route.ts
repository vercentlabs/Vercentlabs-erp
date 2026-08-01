import {
  assessSalesOrderReadiness,
  bulkUpdateSalesOrders,
  captureSalesOrderGovernanceSnapshot,
  compareSalesOrderVersions,
  createSalesReturnRequest,
  deleteSalesOrderSavedView,
  getSalesOrderGovernanceDashboard,
  getSalesOrderGovernanceTimeline,
  listSalesOrderSavedViews,
  reserveSalesOrderLines,
  saveSalesOrderView,
} from "@vercentlabs/api";

import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { rethrowSalesError } from "@/lib/sales";
import { salesSession, tenantTransaction } from "@/lib/sales-route";

function required(value: string | null, label: string) {
  const result = String(value || "").trim();
  if (!result) throw new HttpError(400, `${label} is required.`);
  return result;
}

export async function GET(request: Request) {
  try {
    const { context } = await salesSession();
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "dashboard";
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (mode === "dashboard")
          return getSalesOrderGovernanceDashboard(client, context);
        if (mode === "readiness")
          return assessSalesOrderReadiness(
            client,
            context,
            required(url.searchParams.get("id"), "Sales order"),
          );
        if (mode === "timeline")
          return getSalesOrderGovernanceTimeline(
            client,
            context,
            required(url.searchParams.get("id"), "Sales order"),
          );
        if (mode === "compare")
          return compareSalesOrderVersions(
            client,
            context,
            required(url.searchParams.get("id"), "Sales order"),
            required(url.searchParams.get("leftVersionId"), "Left version"),
            required(url.searchParams.get("rightVersionId"), "Right version"),
          );
        if (mode === "views") return listSalesOrderSavedViews(client, context);
        throw new HttpError(400, "Unsupported sales-order operation.");
      },
    );
    return ok({ result });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, context } = await salesSession(true);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "A sales-order operation is required.");
    const input = body as Record<string, unknown>;
    const action = String(input.action || "").trim();
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        let value: Record<string, unknown>;
        if (action === "bulk_update")
          value = await bulkUpdateSalesOrders(client, context, input);
        else if (action === "save_view")
          value = await saveSalesOrderView(client, context, input);
        else if (action === "delete_view")
          value = await deleteSalesOrderSavedView(
            client,
            context,
            String(input.id || ""),
          );
        else if (action === "snapshot")
          value = await captureSalesOrderGovernanceSnapshot(
            client,
            context,
            String(input.id || ""),
            String(input.capturedFor || "manual"),
          );
        else if (action === "reserve_lines")
          value = await reserveSalesOrderLines(
            client,
            context,
            String(input.id || ""),
            input,
          );
        else if (action === "request_return")
          value = await createSalesReturnRequest(
            client,
            context,
            String(input.id || ""),
            input,
          );
        else throw new HttpError(400, "Unsupported sales-order operation.");

        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `sales.order.operations.${action}`,
          entityType: "sales_order",
          entityId:
            typeof input.id === "string" ? input.id : "bulk-or-configuration",
          afterData: value,
          request,
          client,
        });
        return value;
      },
    );
    return ok({ result });
  } catch (error) {
    try {
      rethrowSalesError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
