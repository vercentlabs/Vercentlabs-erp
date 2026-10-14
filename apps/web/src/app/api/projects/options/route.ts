import { getProjectOptions } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// What a project form needs: types, people who can be on projects, priorities, roles and the company's policy.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ options: await getProjectOptions(client, context) }));
}
