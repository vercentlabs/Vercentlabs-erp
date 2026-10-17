import { submitTimesheet } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Submit a week's unsubmitted time: one review per project.
const schema = z.object({ weekStart: z.string().max(10).optional(), projectIds: z.array(z.string().uuid()).max(50).optional(), lateReason: z.string().max(1000).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => submitTimesheet(client, context, input));
}
