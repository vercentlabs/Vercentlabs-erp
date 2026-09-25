import { revokeSalesApprovalDelegation } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", emptySchema, async (client, context) => ({ delegation: await revokeSalesApprovalDelegation(client, context, id) }));
}
