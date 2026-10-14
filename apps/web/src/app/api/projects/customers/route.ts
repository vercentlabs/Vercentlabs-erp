import { searchProjectCustomers } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Customers of the shared customer master a project may be for (?search=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ customers: await searchProjectCustomers(client, context, url.searchParams.get("search") ?? "") }));
}
