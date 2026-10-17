import { recoverTimePosting } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Cost the approved time that had no rate when it was approved (idempotent).
const schema = z.object({ projectId: z.string().uuid().optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => recoverTimePosting(client, context, input));
}
