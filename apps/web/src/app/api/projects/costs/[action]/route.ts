import { decideProjectBudget, endOverheadPolicy, listOverheadPolicies, reverseOverheadAllocation, setOverheadPolicy } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET overhead-policies · POST decide-budget { budgetId, decision, note? } · overhead-policy { method, rate, projectId?, effectiveFrom, effectiveTo?, description }
// · end-overhead-policy { policyId, effectiveTo? } · reverse-overhead { allocationId, reason }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return projectsRead(request, async (client, context) => {
    if (action === "overhead-policies") return { rows: await listOverheadPolicies(client, context) };
    throw new HttpError(404, "Unknown view.", "NOT_FOUND");
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "decide-budget") return decideProjectBudget(client, context, String(input.budgetId ?? ""), input);
    if (action === "overhead-policy") return setOverheadPolicy(client, context, input);
    if (action === "end-overhead-policy") return endOverheadPolicy(client, context, String(input.policyId ?? ""), input);
    if (action === "reverse-overhead") return reverseOverheadAllocation(client, context, String(input.allocationId ?? ""), input);
    throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  });
}
