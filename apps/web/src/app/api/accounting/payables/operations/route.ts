import {
  assessVendorBillReadiness,
  bulkManagePayablesExceptions,
  capturePayablesGovernanceSnapshot,
  changeVendorPaymentProposalStatus,
  createVendorPaymentProposal,
  deletePayablesSavedView,
  getPayablesGovernanceDashboard,
  getVendorBillGovernanceTimeline,
  listPayablesSavedViews,
  listVendorPaymentProposals,
  prepareVendorPaymentsFromProposal,
  refreshPayablesAging,
  savePayablesView,
  upsertPayablesExceptionCase,
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
          return getPayablesGovernanceDashboard(client, context);
        }
        if (action === "readiness") {
          return assessVendorBillReadiness(
            client,
            context,
            requiredId(url.searchParams.get("billId"), "Vendor bill"),
          );
        }
        if (action === "timeline") {
          return getVendorBillGovernanceTimeline(
            client,
            context,
            requiredId(url.searchParams.get("billId"), "Vendor bill"),
          );
        }
        if (action === "saved_views") {
          return listPayablesSavedViews(client, context);
        }
        if (action === "payment_proposals") {
          return listVendorPaymentProposals(client, context);
        }
        throw new HttpError(400, "Unsupported payables operation.");
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
          return capturePayablesGovernanceSnapshot(
            client,
            context,
            requiredId(input.billId, "Vendor bill"),
            String(input.capturedFor || "manual"),
          );
        }
        if (action === "save_view") {
          return savePayablesView(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "delete_view") {
          return deletePayablesSavedView(
            client,
            context,
            requiredId(input.viewId, "Saved view"),
          );
        }
        if (action === "exception_case") {
          return upsertPayablesExceptionCase(
            client,
            context,
            requiredId(input.billId, "Vendor bill"),
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "bulk_exception_case") {
          return bulkManagePayablesExceptions(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "create_payment_proposal") {
          return createVendorPaymentProposal(
            client,
            context,
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "change_payment_proposal_status") {
          return changeVendorPaymentProposalStatus(
            client,
            context,
            requiredId(input.proposalId, "Payment proposal"),
            (input.input || {}) as Record<string, unknown>,
          );
        }
        if (action === "prepare_vendor_payments") {
          return prepareVendorPaymentsFromProposal(
            client,
            context,
            requiredId(input.proposalId, "Payment proposal"),
          );
        }
        if (action === "refresh_aging") {
          return refreshPayablesAging(client, context);
        }
        throw new HttpError(400, "Unsupported payables operation.");
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
