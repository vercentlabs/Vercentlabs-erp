import { authorizeContractLine, listContractLineCandidates } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The sales order lines that could authorize hourly time (GET), and authorizing one as a contract line (POST) — its rate is the order's.
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ salesOrderLineId: z.string().uuid(), label: z.string().max(120).optional(), effectiveFrom: z.string().max(10), effectiveTo: z.string().max(10).optional(),
  maxMinutes: z.number().int().optional(), roundingMinutes: z.number().int().optional(), allowedTaskTypes: z.array(z.string().max(40)).max(20).optional(),
  allowedUserIds: z.array(z.string().uuid()).max(200).optional() });
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => listContractLineCandidates(client, context, id));
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => authorizeContractLine(client, context, id, input), 201);
}
