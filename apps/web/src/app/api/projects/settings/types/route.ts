import { saveProjectType } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Create or change a project type.
const schema = z.object({ id: z.string().uuid().optional(), code: z.string().max(60).optional(), name: z.string().min(1).max(80), description: z.string().max(500).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => saveProjectType(client, context, input), 200, "projects.settings.manage");
}
