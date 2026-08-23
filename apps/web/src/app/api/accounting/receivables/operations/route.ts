import {
  assessCustomerInvoiceReadiness,
  bulkManageReceivablesCollections,
  captureReceivablesGovernanceSnapshot,
  deleteReceivablesSavedView,
  getCustomerInvoiceGovernanceTimeline,
  getReceivablesGovernanceDashboard,
  listReceivablesSavedViews,
  refreshReceivablesAging,
  saveReceivablesView,
  upsertReceivablesCollectionCase,
} from "@vercentlabs/api";

import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

function requiredId(value: unknown, label: string) {
  const result = String(value || "").trim();
  if (!result) throw new HttpError(400, `${label} is required.`);
  return result;
}

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "dashboard";
    const result = await tenantTransaction<unknown>(
      context.organizationId,
      (client) => {
        if (action === "dashboard") {
          return getReceivablesGovernanceDashboard(client, context);
        }
        if (action === "readiness") {
          return assessCustomerInvoiceReadiness(
            client,
            context,
            requiredId(url.searchParams.get("invoiceId"), "Invoice"),
          );
        }
        if (action === "timeline") {
          return getCustomerInvoiceGovernanceTimeline(
            client,
            context,
            requiredId(url.searchParams.get("invoiceId"), "Invoice"),
          );
        }
        if (action === "saved_views") {
          return listReceivablesSavedViews(client, context);
        }
        throw new HttpError(400, "Unsupported receivables operation.");
      },
    );
    return ok({ result });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "");
    const result = await tenantTransaction<unknown>(
      context.organizationId,
      (client) => {
        if (action === "capture_snapshot") {
          return captureReceivablesGovernanceSnapshot(
            client,
            context,
            requiredId(input.invoiceId, "Invoice"),
            String(input.capturedFor || "manual"),
          );
        }
        if (action === "save_view") {
          return saveReceivablesView(
            client,
            context,
            input.input as Record<string, unknown>,
          );
        }
        if (action === "delete_view") {
          return deleteReceivablesSavedView(
            client,
            context,
            requiredId(input.viewId, "Saved view"),
          );
        }
        if (action === "collection_case") {
          return upsertReceivablesCollectionCase(
            client,
            context,
            requiredId(input.invoiceId, "Invoice"),
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "bulk_collection_case") {
          return bulkManageReceivablesCollections(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "refresh_aging") {
          return refreshReceivablesAging(client, context);
        }
        throw new HttpError(400, "Unsupported receivables operation.");
      },
    );
    return ok({ result });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
