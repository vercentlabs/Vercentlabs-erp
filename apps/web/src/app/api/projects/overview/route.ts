import { getProjectsOverview } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The Projects home: counts, what needs attention and recent activity.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ overview: await getProjectsOverview(client, context) }));
}
