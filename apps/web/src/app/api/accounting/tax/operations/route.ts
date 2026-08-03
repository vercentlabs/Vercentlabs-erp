import {
  assessTaxReturnReadiness,
  bulkManageTaxExceptions,
  captureFinancialReportingSnapshot,
  captureTaxGovernanceSnapshot,
  deleteTaxSavedView,
  getTaxReportingGovernanceDashboard,
  getTaxReturnGovernanceTimeline,
  listTaxSavedViews,
  saveTaxView,
  upsertTaxExceptionCase,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/lib/accounting";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

function requiredId(value: unknown, label: string) {
  const id = String(value || "").trim();
  if (!id) throw new HttpError(400, `${label} is required.`);
  return id;
}

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "dashboard";
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "dashboard") {
          return getTaxReportingGovernanceDashboard(client, context);
        }
        if (action === "readiness") {
          return assessTaxReturnReadiness(
            client,
            context,
            requiredId(url.searchParams.get("taxReturnId"), "Tax return"),
          );
        }
        if (action === "timeline") {
          return getTaxReturnGovernanceTimeline(
            client,
            context,
            requiredId(url.searchParams.get("taxReturnId"), "Tax return"),
          );
        }
        if (action === "views") {
          return listTaxSavedViews(client, context);
        }
        throw new HttpError(400, "Unsupported tax governance operation.");
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
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "snapshot") {
          return captureTaxGovernanceSnapshot(
            client,
            context,
            requiredId(input.taxReturnId, "Tax return"),
            String(input.capturedFor || "manual"),
          );
        }
        if (action === "exception_case") {
          return upsertTaxExceptionCase(
            client,
            context,
            requiredId(input.taxReturnId, "Tax return"),
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "bulk_exception_case") {
          return bulkManageTaxExceptions(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "save_view") {
          return saveTaxView(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "delete_view") {
          return deleteTaxSavedView(
            client,
            context,
            requiredId(input.viewId, "Saved view"),
          );
        }
        if (action === "capture_reporting_snapshot") {
          return captureFinancialReportingSnapshot(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        throw new HttpError(400, "Unsupported tax governance operation.");
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
