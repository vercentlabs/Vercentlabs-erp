import { getProjectFinancialsDirectory } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The Project Financials directory: cost, revenue and profitability per project, each as the person may see it (?status=&classification=&search=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getProjectFinancialsDirectory(client, context, {
    status: url.searchParams.get("status") ?? undefined, classification: url.searchParams.get("classification") ?? undefined, search: url.searchParams.get("search") ?? undefined }));
}
