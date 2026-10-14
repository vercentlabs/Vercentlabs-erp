import { removeProjectCustomerContact, replaceProjectCustomerContact, updateProjectCustomerContact } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string; rowId: string }> };
const update = z.object({
  role: z.enum(["PRIMARY", "SPONSOR", "TECHNICAL", "BILLING", "APPROVAL", "OTHER"]).optional(), title: z.string().max(120).nullable().optional(), replacePrimary: z.boolean().optional(),
  expectedVersion: z.number().int().optional(),
});
// The person's role on the project.
export async function PATCH(request: Request, ctx: Params) {
  const { id, rowId } = await ctx.params;
  return projectsMutation(request, update, async (client, context, input) => updateProjectCustomerContact(client, context, id, rowId, input));
}
// Another of the customer's people takes over the role.
export async function POST(request: Request, ctx: Params) {
  const { id, rowId } = await ctx.params;
  return projectsMutation(request, z.object({ contactId: z.string().uuid(), note: z.string().max(500).optional() }), async (client, context, input) =>
    replaceProjectCustomerContact(client, context, id, rowId, input));
}
// The person leaves the project (their history stays).
export async function DELETE(request: Request, ctx: Params) {
  const { id, rowId } = await ctx.params;
  return projectsMutation(request, z.object({ note: z.string().max(500).optional() }), async (client, context, input) => removeProjectCustomerContact(client, context, id, rowId, input));
}
