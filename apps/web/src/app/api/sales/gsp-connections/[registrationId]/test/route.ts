import { testGspConnection } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

// Asks the GSP whether the saved credentials work; the answer is kept on the connection.
export async function POST(request: Request, ctx: { params: Promise<{ registrationId: string }> }) {
  const { registrationId } = await ctx.params;
  return salesMutation(request, "sales.view", emptySchema, async (client, context) => testGspConnection(client, context, registrationId));
}
