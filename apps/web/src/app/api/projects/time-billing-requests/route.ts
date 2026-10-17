import { createTimeBillingRequest, listTimeBillingRequests } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// Time billing requests (?status=, ?projectId=), and reserving approved eligible minutes in a new one.
const schema = z.object({ projectId: z.string().uuid(), contractLineId: z.string().uuid().optional(), note: z.string().max(1000).optional(),
  entries: z.array(z.object({ entryId: z.string().uuid(), minutes: z.number().int().optional() })).min(1).max(500), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listTimeBillingRequests(client, context, { status: url.searchParams.get("status") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined }));
}
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => createTimeBillingRequest(client, context, input.projectId, input), 201);
}
