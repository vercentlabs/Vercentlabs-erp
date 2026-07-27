import {
  startBankReconciliation,
  suggestBankMatches,
  type AccountingRecord,
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

    let result: AccountingRecord | AccountingRecord[];
    if (action === "reconcile") {
      result = await tenantTransaction(context.organizationId, (client) =>
        startBankReconciliation(client, context, { bankStatementId: id }),
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
