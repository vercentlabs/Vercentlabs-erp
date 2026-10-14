import { decideResume, getProductionHoldHistory, getResumeReadiness, requestResume, resumeFromProductionHold } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { resumeSchema } from "@/features/manufacturing/holds/api/hold-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET readiness (what resuming needs now; ?proceedWithShortages=true) · history (every hold episode of the order).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  const proceed = new URL(request.url).searchParams.get("proceedWithShortages") === "true";
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "readiness": return { readiness: await getResumeReadiness(client, context, id, { proceedWithShortages: proceed }) };
      case "history": return { history: await getProductionHoldHistory(client, context, id) };
      default: throw new HttpError(404, "Unknown hold view.", "NOT_FOUND");
    }
  });
}

// resume (every reason cleared, ready) · request-resume (where the company asks for an approval) · decide-resume (decision APPROVE | REJECT).
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, resumeSchema, async (client, context, input) => {
    switch (action) {
      case "resume": return resumeFromProductionHold(client, context, id, input);
      case "request-resume": return requestResume(client, context, id, input);
      case "decide-resume": return decideResume(client, context, id, input);
      default: throw new HttpError(404, "Unknown hold action.", "NOT_FOUND");
    }
  });
}
