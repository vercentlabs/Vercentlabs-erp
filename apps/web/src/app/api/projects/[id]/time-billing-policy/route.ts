import { getProjectTimeBillingPolicy, setProjectTimeBillingPolicy } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// A project's time-billing policy (versioned), its contract lines and task rules; changing the policy makes a new version.
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ billingMethod: z.string().max(40), defaultContractLineId: z.string().uuid().nullable().optional(), reference: z.string().max(200).optional(),
  note: z.string().max(1000).optional(), expectedVersion: z.number().int().optional() });
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ policy: await getProjectTimeBillingPolicy(client, context, id) }));
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => setProjectTimeBillingPolicy(client, context, id, input));
}
