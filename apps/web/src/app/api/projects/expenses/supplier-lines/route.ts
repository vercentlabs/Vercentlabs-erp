import { searchSupplierBillLines } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Supplier bill lines Finance may allocate to a project, with what is left of each (?search=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ lines: await searchSupplierBillLines(client, context, { search: url.searchParams.get("search") ?? "" }) }));
}
