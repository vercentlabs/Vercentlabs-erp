import {
  addNonconformanceAction, addNonconformanceLink, assignNonconformance, cancelNonconformance, cancelNonconformanceAction, closeNonconformance, completeNonconformanceAction,
  completeNonconformanceLink, recordNonconformanceContainment, recordNonconformanceInvestigation, reopenNonconformance, requireNonconformanceAction, startNonconformanceReview,
  submitNonconformanceForVerification, updateNonconformance, verifyNonconformance,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// POST update · assign · start-review · contain · investigate · add-action · complete-action · cancel-action · require-action · submit ·
// verify · close · reopen · cancel · add-link · complete-link. Each domain function enforces its own permission, state and separation of duties.
type Params = { params: Promise<{ ncId: string; action: string }> };
const STEPS = {
  update: updateNonconformance, assign: assignNonconformance, "start-review": startNonconformanceReview, contain: recordNonconformanceContainment,
  investigate: recordNonconformanceInvestigation, "add-action": addNonconformanceAction, "complete-action": completeNonconformanceAction, "cancel-action": cancelNonconformanceAction,
  "require-action": requireNonconformanceAction, submit: submitNonconformanceForVerification, verify: verifyNonconformance, close: closeNonconformance, reopen: reopenNonconformance,
  cancel: cancelNonconformance, "add-link": addNonconformanceLink, "complete-link": completeNonconformanceLink,
} as const;
export async function POST(request: Request, ctx: Params) {
  const { ncId, action } = await ctx.params;
  const step = STEPS[action as keyof typeof STEPS];
  if (!step) throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => step(client, context, ncId, input), 200, "quality.nonconformance.view");
}
