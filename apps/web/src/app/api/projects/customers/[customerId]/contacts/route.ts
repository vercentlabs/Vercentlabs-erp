import { listProjectCustomerContacts } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The contacts of one customer.
export async function GET(request: Request, ctx: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ contacts: await listProjectCustomerContacts(client, context, customerId) }));
}
