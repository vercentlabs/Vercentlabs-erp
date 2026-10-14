import { assignProjectCustomer, getProjectCustomer } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };
// The project's customer, contacts, sites, review flag and pending customer change.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ customer: await getProjectCustomer(client, context, id) }));
}
const schema = z.object({
  customerId: z.string().uuid().nullable().optional(), crmAccountId: z.string().uuid().nullable().optional(), primaryContactId: z.string().uuid().nullable().optional(),
  linkedSalesOrderId: z.string().uuid().optional(), linkedSalesOrderLineIds: z.array(z.string().uuid()).max(200).optional(), expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
// Choose (or replace, or clear) a draft's customer.
export async function PUT(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => assignProjectCustomer(client, context, id, input));
}
