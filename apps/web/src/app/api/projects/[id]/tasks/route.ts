import { createProjectTask, getProjectTasks } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// A project's tasks (with its summary, milestones and what the person may do), and a new task. The project comes from the route.
type Params = { params: Promise<{ id: string }> };
const KEYS = ["view", "projectId", "milestoneId", "assigneeId", "status", "priority", "type", "tag", "search", "due", "sort", "direction", "page", "pageSize"];
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => getProjectTasks(client, context, id,
    Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""))), "projects.tasks.view");
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => createProjectTask(client, context, id, input), 201, "projects.tasks.create");
}
