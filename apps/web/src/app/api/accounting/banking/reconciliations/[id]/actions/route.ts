import {
  captureBankingGovernanceSnapshot,
  completeBankReconciliation,
  matchBankStatementLine,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/lib/accounting";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
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
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "");
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const reconciliation = await client.query(
          `SELECT bank_statement_id
             FROM tenant.accounting_reconciliations
            WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, id],
        );
        const statementId = String(
          reconciliation.rows[0]?.bank_statement_id || "",
        );
        if (!statementId) {
          throw new HttpError(404, "Reconciliation was not found.");
        }

        const operation =
          action === "complete"
            ? await completeBankReconciliation(client, context, id)
            : action === "match"
              ? await matchBankStatementLine(client, context, id, input)
              : await Promise.reject(
                  new HttpError(400, "Unsupported reconciliation action."),
                );

        await captureBankingGovernanceSnapshot(
          client,
          context,
          statementId,
          action === "complete" ? "reconciliation_completed" : "line_matched",
        );
        return operation;
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
