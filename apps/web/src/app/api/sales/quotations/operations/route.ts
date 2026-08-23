import {
  assessQuotationReadiness,
  bulkUpdateQuotations,
  captureQuotationGovernanceSnapshot,
  compareQuotationVersions,
  deleteQuotationSavedView,
  getQuotationGovernanceDashboard,
  getQuotationGovernanceTimeline,
  listQuotationSavedViews,
  saveQuotationView,
} from "@vercentlabs/api";

import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { rethrowSalesError } from "@/modules/sales";
import { salesSession, tenantTransaction } from "@/modules/sales/server";

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
          return getQuotationGovernanceDashboard(client, context);
        if (mode === "readiness")
          return assessQuotationReadiness(
            client,
            context,
            required(url.searchParams.get("id"), "Quotation"),
          );
        if (mode === "timeline")
          return getQuotationGovernanceTimeline(
            client,
            context,
            required(url.searchParams.get("id"), "Quotation"),
          );
        if (mode === "compare")
          return compareQuotationVersions(
            client,
            context,
            required(url.searchParams.get("id"), "Quotation"),
            required(url.searchParams.get("leftVersionId"), "Left version"),
            required(url.searchParams.get("rightVersionId"), "Right version"),
          );
        if (mode === "views") return listQuotationSavedViews(client, context);
        throw new HttpError(400, "Unsupported quotation operation.");
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
      throw new HttpError(400, "A quotation operation is required.");
    const input = body as Record<string, unknown>;
    const action = String(input.action || "").trim();
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        let value: Record<string, unknown>;
        if (action === "bulk_update")
          value = await bulkUpdateQuotations(client, context, input);
        else if (action === "save_view")
          value = await saveQuotationView(client, context, input);
        else if (action === "delete_view")
          value = await deleteQuotationSavedView(
            client,
            context,
            String(input.id || ""),
          );
        else if (action === "snapshot")
          value = await captureQuotationGovernanceSnapshot(
            client,
            context,
            String(input.id || ""),
            String(input.capturedFor || "manual"),
          );
        else throw new HttpError(400, "Unsupported quotation operation.");

        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `sales.quotation.operations.${action}`,
          entityType: "sales_quotation",
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
