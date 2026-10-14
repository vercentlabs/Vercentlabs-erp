import { listProjectViews, saveProjectView } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The person's saved project views (one may be the default).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ views: await listProjectViews(client, context) }));
}
const schema = z.object({ name: z.string().min(1).max(80), filters: z.record(z.string(), z.string().max(200)).default({}), isDefault: z.boolean().optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => saveProjectView(client, context, input), 201);
}
