import {
  applyCustomerCreditNote,
  captureReceivablesGovernanceSnapshot,
  postCustomerInvoice,
  submitCustomerInvoice,
} from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { accountingActionSchema } from "@/lib/accounting-validation";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

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
          const document = await submitCustomerInvoice(
            client,
            context,
            id,
            input.assignedTo,
          );
          await captureReceivablesGovernanceSnapshot(
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
          const document = await postCustomerInvoice(client, context, id);
          await captureReceivablesGovernanceSnapshot(
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
          const document = await applyCustomerCreditNote(
            client,
            context,
            id,
            input.input || {},
          );
          await captureReceivablesGovernanceSnapshot(
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
    throw new HttpError(400, "Unsupported invoice action.");
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
