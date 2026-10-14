import { listMyProjects } from "@vercentlabs/api";

import { listFilters, projectsRead } from "@/features/projects/shared/route-helpers";

// The projects the person manages or belongs to.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listMyProjects(client, context, listFilters(url)));
}
