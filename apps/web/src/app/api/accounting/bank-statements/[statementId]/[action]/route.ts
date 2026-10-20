import { z } from "zod";

import { completeStatementReconciliation, reopenStatementReconciliation } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ statementId: string; action: string }> };
const schema = z.object({ reason: z.string().trim().max(500).optional() });

// complete · reopen (with a reason).
export async function POST(request: Request, { params }: Params) {
  const { statementId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    if (action === "complete") return { workspace: await completeStatementReconciliation(client, context, statementId) };
    if (action === "reopen") return { workspace: await reopenStatementReconciliation(client, context, statementId, { reason: input.reason ?? "" }) };
    throw new HttpError(404, "Unknown statement action.");
  });
}
