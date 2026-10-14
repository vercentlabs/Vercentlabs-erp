import { importProjects } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A CSV of projects, each row a draft; bad rows are reported, the rest created (once per import key).
const schema = z.object({ csv: z.string().min(1).max(2_000_000), importKey: z.string().trim().min(1).max(120) });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => importProjects(client, context, input), 200, "projects.create");
}
