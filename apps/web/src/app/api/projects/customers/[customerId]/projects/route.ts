import { getCustomerProjects } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The projects of one customer the person may see, with their counts (the customer and CRM account records show them).
export async function GET(request: Request, ctx: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await ctx.params;
  return projectsRead(request, async (client, context) => getCustomerProjects(client, context, customerId));
}
