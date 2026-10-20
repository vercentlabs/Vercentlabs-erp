import { getReconciliationWorkspace } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ statementId: string }> };

// The reconciliation workspace of one statement.
export async function GET(request: Request, { params }: Params) {
  const { statementId } = await params;
  return accountingRead(request, async (client, context) => ({ workspace: await getReconciliationWorkspace(client, context, statementId) }));
}
