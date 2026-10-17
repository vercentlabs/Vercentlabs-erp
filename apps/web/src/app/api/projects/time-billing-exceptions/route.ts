import { getTimeBillingExceptions } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// What needs attention in time billing (waiting on Sales, cancelled invoices, time without a contract line, allowances nearly used).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => getTimeBillingExceptions(client, context));
}
