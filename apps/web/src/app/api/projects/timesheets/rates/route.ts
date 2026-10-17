import { listProjectLaborRates, setProjectLaborRate } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// Internal labor cost rates (effective-dated, versioned), for those who may see cost or manage rates.
const schema = z.object({ userId: z.string().uuid(), projectId: z.string().uuid().optional(), hourlyRate: z.number(), currency: z.string().max(3).optional(), effectiveFrom: z.string().max(10),
  reason: z.string().max(500).optional() });
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listProjectLaborRates(client, context, { userId: url.searchParams.get("userId") ?? undefined }));
}
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => setProjectLaborRate(client, context, input), 201);
}
