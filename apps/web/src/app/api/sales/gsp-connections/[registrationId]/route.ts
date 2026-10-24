import { z } from "zod";

import { deleteGspConnection, saveGspConnection } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ registrationId: string }> };
const schema = z.object({ provider: z.string().min(1).max(40), baseUrl: z.string().max(300).optional(), username: z.string().max(120).optional(), token: z.string().max(4000).optional() });

// Connects (or replaces) the GSTIN's GSP account. The token is encrypted and never shown again.
export async function PUT(request: Request, ctx: Params) {
  const { registrationId } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => saveGspConnection(client, context, registrationId, input));
}

export async function DELETE(request: Request, ctx: Params) {
  const { registrationId } = await ctx.params;
  return salesMutation(request, "sales.view", emptySchema, async (client, context) => deleteGspConnection(client, context, registrationId));
}
