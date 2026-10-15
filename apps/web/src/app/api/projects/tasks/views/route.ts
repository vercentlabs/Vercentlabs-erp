import { listTaskViews, saveTaskView } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The person's saved task views.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ views: await listTaskViews(client, context) }), "projects.tasks.view");
}
const schema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), filters: z.record(z.string(), z.string()), isDefault: z.boolean().optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => saveTaskView(client, context, input), 201, "projects.tasks.view");
}
