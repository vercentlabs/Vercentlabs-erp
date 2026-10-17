import { getTimeEntryOptions } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The projects the person records time on, with each one's billing policy.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => getTimeEntryOptions(client, context));
}
