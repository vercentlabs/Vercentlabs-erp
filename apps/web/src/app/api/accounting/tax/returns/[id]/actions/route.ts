import {
  captureTaxGovernanceSnapshot,
  updateTaxReturnStatus,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/modules/accounting";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { taxReturnActionSchema } from "@/modules/accounting/validation";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { session, context: accountingContext } =
      await accountingSession(true);
    const input = taxReturnActionSchema.parse(await readJson(request));
    const taxReturn = await tenantTransaction(
      accountingContext.organizationId,
      async (client) => {
        const updated = await updateTaxReturnStatus(
          client,
          accountingContext,
          id,
          input,
        );
        await captureTaxGovernanceSnapshot(
          client,
          accountingContext,
          id,
          `status_${String(input.status)}`,
        );
        await audit({
          organizationId: accountingContext.organizationId,
          actorUserId: session.userId,
          eventType: "accounting.tax_return.status_changed",
          entityType: "accounting_tax_return",
          entityId: id,
          afterData: input,
          request,
          client,
        });
        return updated;
      },
    );
    return ok({ taxReturn, message: "Tax return status updated." });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
