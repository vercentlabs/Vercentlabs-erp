import { remindTimesheet } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A project manager reminds a team member about a week.
const schema = z.object({ employeeUserId: z.string().uuid(), projectId: z.string().uuid(), weekStart: z.string().max(10).optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => remindTimesheet(client, context, input));
}
