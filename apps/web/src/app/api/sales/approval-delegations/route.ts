import { z } from "zod";

import { createSalesApprovalDelegation, listSalesApprovalDelegations } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  delegatorUserId: z.string().uuid().nullish(),
  delegateUserId: z.string().uuid(),
  startsOn: z.string().trim().min(10),
  endsOn: z.string().trim().min(10),
  reason: z.string().trim().max(500),
});

// F041: approval delegation while an approver is away.
export async function GET() {
  return salesRead("sales.view", async (client, context) => ({ rows: await listSalesApprovalDelegations(client, context) }));
}
export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ delegation: await createSalesApprovalDelegation(client, context, input) }), 201);
}
