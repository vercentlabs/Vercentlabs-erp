import { getProgressSettings, saveProgressSettings } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// Whether project managers get a weekly progress summary.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ settings: await getProgressSettings(client, context) }));
}
export async function POST(request: Request) {
  return projectsMutation(request, z.object({ weeklySummary: z.boolean() }), async (client, context, input) => ({ settings: await saveProgressSettings(client, context, input) }));
}
