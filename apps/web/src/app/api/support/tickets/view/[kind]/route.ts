import { getSupportCounts, getSupportDashboard, listCustomerContactsForSupport, listSupportOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { supportRead } from "@/features/support/shared/route-helpers";

// Support reads: counts (the queues) · dashboard · options · contacts (?customerId) of a customer.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const customerId = new URL(request.url).searchParams.get("customerId") ?? "";
  return supportRead(request, async (client, context) => {
    switch (kind) {
      case "counts": return { counts: await getSupportCounts(client, context) };
      case "dashboard": return getSupportDashboard(client, context);
      case "options": return listSupportOptions(client, context);
      case "contacts": return { contacts: await listCustomerContactsForSupport(client, context, customerId) };
      default: throw new HttpError(404, "Unknown support view.");
    }
  });
}
