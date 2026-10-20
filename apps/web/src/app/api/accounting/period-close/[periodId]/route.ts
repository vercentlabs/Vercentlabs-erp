import { getPeriodCloseWorkspace } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ periodId: string }> };

// One month's close: its readiness checks, acknowledgements, what can be done next, and its trail.
export async function GET(request: Request, { params }: Params) {
  const { periodId } = await params;
  return accountingRead(request, async (client, context) => ({ workspace: await getPeriodCloseWorkspace(client, context, periodId) }));
}
