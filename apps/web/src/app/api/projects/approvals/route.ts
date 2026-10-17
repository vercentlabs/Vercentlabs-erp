import { getProjectApprovals } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Every decision waiting for the person across Projects, read through each owning workflow.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => getProjectApprovals(client, context));
}
