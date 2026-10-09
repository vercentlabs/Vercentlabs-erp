import { z } from "zod";

import {
  saveQualitySettings,
  defineQualityPlan,
  approveQualityPlan,
  reviseQualityPlan,
  retireQualityPlan,
  createQualityInspection,
  recordInspectionResults,
  completeQualityInspection,
  releaseQualityInspection,
  cancelQualityInspection,
  createQualityNonconformance,
  transitionNonconformance,
  setDisposition,
  approveUseAsIs,
  closeNonconformance,
  cancelNonconformance,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Quality operation. Each domain function enforces its OWN permission, state
// machine and segregation of duties.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return qualityMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveQualitySettings(client, context, input) };
        case "plan-create":
          return { record: await defineQualityPlan(client, context, input) };
        case "plan-approve":
          return {
            record: await approveQualityPlan(client, context, idOf(input)),
          };
        case "plan-revise":
          return {
            record: await reviseQualityPlan(client, context, idOf(input)),
          };
        case "plan-retire":
          return {
            record: await retireQualityPlan(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "inspection-create":
          return {
            record: await createQualityInspection(client, context, input),
          };
        case "inspection-results":
          return {
            record: await recordInspectionResults(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "inspection-complete":
          return {
            record: await completeQualityInspection(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "inspection-release":
          return {
            record: await releaseQualityInspection(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "inspection-cancel":
          return {
            record: await cancelQualityInspection(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "nc-create":
          return {
            record: await createQualityNonconformance(client, context, input),
          };
        case "nc-transition":
          return {
            record: await transitionNonconformance(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "nc-disposition":
          return {
            record: await setDisposition(client, context, idOf(input), input),
          };
        case "nc-use-as-is-decide":
          return {
            record: await approveUseAsIs(client, context, idOf(input), input),
          };
        case "nc-close":
          return {
            record: await closeNonconformance(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "nc-cancel":
          return {
            record: await cancelNonconformance(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        default:
          throw new HttpError(404, "Unknown Quality action.");
      }
    },
    200,
    "quality.view",
  );
}
