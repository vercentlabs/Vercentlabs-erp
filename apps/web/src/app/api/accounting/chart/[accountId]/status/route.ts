import { z } from "zod";

import { setChartAccountStatus } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ accountId: string }> };

// Deactivate (keeps history, stops new postings) or reactivate.
export async function POST(request: Request, { params }: Params) {
  const { accountId } = await params;
  return accountingMutation(request, z.object({ status: z.enum(["active", "inactive"]) }), async (client, context, input) => ({
    account: await setChartAccountStatus(client, context, accountId, input.status),
  }));
}
