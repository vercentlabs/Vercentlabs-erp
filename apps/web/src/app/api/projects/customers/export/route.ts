import { exportProjectCustomers } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The customer associations of the projects the person may see, as CSV (?customerId=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => exportProjectCustomers(client, context, { customerId: url.searchParams.get("customerId") ?? undefined }), "projects.customer.export");
}
