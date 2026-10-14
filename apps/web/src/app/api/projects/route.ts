import { createProjectDraft, listProjects } from "@vercentlabs/api";
import { z } from "zod";

import { listFilters, projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";
import { projectFields } from "@/features/projects/shared/schemas";

// The project directory (only what the person may see): views, search, filters, sorting and paging.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listProjects(client, context, listFilters(url)));
}

const schema = z.object({ ...projectFields, members: z.array(z.object({ userId: z.string().uuid(), role: z.enum(["MEMBER", "VIEWER", "FINANCIAL_VIEWER"]) })).max(50).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional() });
// A new project, saved as a draft (once per request key).
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => createProjectDraft(client, context, input), 201);
}
