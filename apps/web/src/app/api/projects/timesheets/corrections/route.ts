import { listTimeCorrections } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Corrections of approved time the person asked for, is the subject of, or decides (?status=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listTimeCorrections(client, context, { status: url.searchParams.get("status") ?? undefined }));
}
