import {
  assessBankStatementReadiness,
  bulkManageReconciliationExceptions,
  captureBankingGovernanceSnapshot,
  captureCashPositionSnapshot,
  captureCloseReadinessSnapshot,
  deleteBankingSavedView,
  getBankingGovernanceDashboard,
  getBankStatementGovernanceTimeline,
  listBankingSavedViews,
  saveBankingView,
  upsertReconciliationExceptionCase,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/lib/accounting";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

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
          return getBankingGovernanceDashboard(client, context);
        }
        if (action === "readiness") {
          return assessBankStatementReadiness(
            client,
            context,
            requiredId(url.searchParams.get("statementId"), "Bank statement"),
          );
        }
        if (action === "timeline") {
          return getBankStatementGovernanceTimeline(
            client,
            context,
            requiredId(url.searchParams.get("statementId"), "Bank statement"),
          );
        }
        if (action === "saved_views") {
          return listBankingSavedViews(client, context);
        }
        throw new HttpError(400, "Unsupported banking operation.");
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
          return captureBankingGovernanceSnapshot(
            client,
            context,
            requiredId(input.statementId, "Bank statement"),
            String(input.capturedFor || "manual"),
          );
        }
        if (action === "save_view") {
          return saveBankingView(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "delete_view") {
          return deleteBankingSavedView(
            client,
            context,
            requiredId(input.viewId, "Saved view"),
          );
        }
        if (action === "exception_case") {
          return upsertReconciliationExceptionCase(
            client,
            context,
            requiredId(input.statementId, "Bank statement"),
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "bulk_exception_case") {
          return bulkManageReconciliationExceptions(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "capture_cash_position") {
          return captureCashPositionSnapshot(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "capture_close_readiness") {
          return captureCloseReadinessSnapshot(
            client,
            context,
            requiredId(input.companyId, "Company"),
            requiredId(input.fiscalPeriodId, "Fiscal period"),
          );
        }
        throw new HttpError(400, "Unsupported banking operation.");
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
