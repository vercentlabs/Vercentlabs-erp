import { deletePriceListFormula } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; formulaId: string }> }) {
  const { id, formulaId } = await ctx.params;
  return salesMutation(request, "sales.view", emptySchema, async (client, context) => deletePriceListFormula(client, context, id, formulaId));
}
