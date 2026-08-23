import {
  captureBankingGovernanceSnapshot,
  startBankReconciliation,
  suggestBankMatches,
  type AccountingRecord,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/modules/accounting";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
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
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "");

    let result: AccountingRecord | AccountingRecord[];
    if (action === "reconcile") {
      result = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const reconciliation = await startBankReconciliation(
            client,
            context,
            {
              bankStatementId: id,
            },
          );
          await captureBankingGovernanceSnapshot(
            client,
            context,
            id,
            "reconciliation_started",
          );
          return reconciliation;
        },
      );
    } else if (action === "suggest") {
      result = await tenantTransaction(context.organizationId, (client) =>
        suggestBankMatches(
          client,
          context,
          String(input.statementLineId || ""),
        ),
      );
    } else {
      throw new HttpError(400, "Unsupported statement action.");
    }

    return ok({ result });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
