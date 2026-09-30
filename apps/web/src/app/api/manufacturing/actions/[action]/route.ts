import { z } from "zod";

import {
  holdProductionOrder,
  recordInspection,
  resumeProductionOrder,
  cancelProductionOrder,
  closeProductionOrder,
  createProductionOrder,
  issueMaterials,
  recordScrap,
  releaseProductionOrder,
  reportProduction,
  returnMaterials,
  updateManufacturingSettings,
  addComponentAlternate,
  approveBom,
  createBom,
  obsoleteBom,
  rejectBom,
  removeComponentAlternate,
  reviseBom,
  submitBom,
  updateDraftBom,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Manufacturing operation. Each domain function enforces its OWN
// permission and state machine (and segregation of duties where a second person must approve).
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return manufacturingMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "bom-create":
          return { record: await createBom(client, context, input) };
        case "bom-update":
          return {
            record: await updateDraftBom(client, context, idOf(input), input),
          };
        case "bom-submit":
          return { record: await submitBom(client, context, idOf(input)) };
        case "bom-approve":
          return { record: await approveBom(client, context, idOf(input)) };
        case "bom-reject":
          return {
            record: await rejectBom(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "bom-obsolete":
          return {
            record: await obsoleteBom(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "bom-revise":
          return {
            record: await reviseBom(client, context, idOf(input), input),
          };
        case "alternate-add":
          return {
            record: await addComponentAlternate(
              client,
              context,
              String(input.componentId ?? ""),
              input,
            ),
          };
        case "alternate-remove":
          return {
            record: await removeComponentAlternate(
              client,
              context,
              idOf(input),
            ),
          };
        case "order-create":
          return {
            record: await createProductionOrder(client, context, input),
          };
        case "order-release":
          return {
            record: await releaseProductionOrder(client, context, idOf(input), {
              allowShortage: input.allowShortage === true,
            }),
          };
        case "order-cancel":
          return {
            record: await cancelProductionOrder(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "order-close":
          return {
            record: await closeProductionOrder(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "material-issue":
          return {
            record: await issueMaterials(
              client,
              context,
              String(input.orderId ?? ""),
              input,
            ),
          };
        case "material-return":
          return {
            record: await returnMaterials(
              client,
              context,
              String(input.orderId ?? ""),
              input,
            ),
          };
        case "production-report":
          return {
            record: await reportProduction(
              client,
              context,
              String(input.orderId ?? ""),
              input,
            ),
          };
        case "scrap-record":
          return {
            record: await recordScrap(
              client,
              context,
              String(input.orderId ?? ""),
              input,
            ),
          };
        case "settings-save":
          return {
            record: await updateManufacturingSettings(client, context, input),
          };
        case "order-hold":
          return {
            record: await holdProductionOrder(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "order-resume":
          return {
            record: await resumeProductionOrder(
              client,
              context,
              idOf(input),
              String(input.note ?? ""),
            ),
          };
        case "inspection-record":
          return {
            record: await recordInspection(
              client,
              context,
              String(input.orderId ?? ""),
              input,
            ),
          };
        default:
          throw new HttpError(404, "Unknown manufacturing action.");
      }
    },
  );
}
