import { searchProjectCustomers } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Customers of the shared customer master a project may be for (?search=, &crmAccounts=1 to include CRM accounts not yet Customers) — only for
// someone who may assign or change a project's customer.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({
    customers: await searchProjectCustomers(client, context, url.searchParams.get("search") ?? "", { includeCrmAccounts: url.searchParams.get("crmAccounts") === "1" }),
  }));
}
