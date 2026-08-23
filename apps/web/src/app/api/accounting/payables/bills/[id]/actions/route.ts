import {
  applyVendorCreditNote,
  capturePayablesGovernanceSnapshot,
  postVendorBill,
  submitVendorBill,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/modules/accounting";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { accountingActionSchema } from "@/modules/accounting/validation";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const input = accountingActionSchema.parse(await readJson(request));
    if (input.action === "submit") {
      const result = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const document = await submitVendorBill(
            client,
            context,
            id,
            input.assignedTo,
          );
          await capturePayablesGovernanceSnapshot(
            client,
            context,
            id,
            "submitted",
          );
          return document;
        },
      );
      return ok({ result });
    }
    if (input.action === "post") {
      const result = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const document = await postVendorBill(client, context, id);
          await capturePayablesGovernanceSnapshot(
            client,
            context,
            id,
            "posted",
          );
          return document;
        },
      );
      return ok({ result });
    }
    if (input.action === "apply_credit") {
      const result = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const document = await applyVendorCreditNote(
            client,
            context,
            id,
            input.input || {},
          );
          await capturePayablesGovernanceSnapshot(
            client,
            context,
            id,
            "credit_applied",
          );
          return document;
        },
      );
      return ok({ result });
    }
    throw new HttpError(400, "Unsupported bill action.");
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
