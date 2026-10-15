import { bulkUpdateProjectTasks } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Several tasks changed at once; each on its own, with a result per task.
const schema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200), action: z.enum(["assign", "priority", "due_date", "status", "cancel"]), assigneeUserId: z.string().uuid().optional(),
  priority: z.string().optional(), dueDate: z.string().optional(), to: z.string().optional(), reason: z.string().max(2000).optional(), acknowledgeDependents: z.boolean().optional(),
  versions: z.record(z.string(), z.number().int()).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => bulkUpdateProjectTasks(client, context, input), 200, "projects.tasks.bulk_manage");
}
