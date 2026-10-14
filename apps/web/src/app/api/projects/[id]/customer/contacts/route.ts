import { addProjectCustomerContact, listProjectCustomerContactsOnProject } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };
// The customer's people on the project (?removed=1 includes those who left).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => listProjectCustomerContactsOnProject(client, context, id, { includeRemoved: url.searchParams.get("removed") === "1" }));
}
const schema = z.object({
  contactId: z.string().uuid(), role: z.enum(["PRIMARY", "SPONSOR", "TECHNICAL", "BILLING", "APPROVAL", "OTHER"]), title: z.string().max(120).optional(), replacePrimary: z.boolean().optional(),
});
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => addProjectCustomerContact(client, context, id, input), 201);
}
