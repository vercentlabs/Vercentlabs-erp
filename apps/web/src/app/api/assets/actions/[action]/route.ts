import { z } from "zod";

import {
  addAssetWorkOrderPart,
  approveAssetDisposal,
  approveAssetTransfer,
  approveDepreciationRun,
  assignAssetToCustodian,
  cancelAssetDisposal,
  cancelAssetTransfer,
  cancelAssetWorkOrder,
  capitalizeAssetRecord,
  completeAssetDisposal,
  completeAssetTransfer,
  completeAssetWorkOrder,
  createAssetFromSource,
  createAssetWorkOrder,
  createDepreciationRun,
  generateDueMaintenance,
  holdAssetWorkOrder,
  postDepreciationRun,
  registerAsset,
  rejectAssetDisposal,
  rejectAssetTransfer,
  requestAssetDisposal,
  requestAssetTransfer,
  returnAsset,
  reverseDepreciationRun,
  saveAssetCategory,
  saveAssetLocation,
  saveAssetSettings,
  saveMaintenancePlan,
  startAssetWorkOrder,
  updateAssetRecord,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const str = (input: Record<string, unknown>, key: string) =>
  String(input[key] ?? "");
const idOf = (input: Record<string, unknown>) => {
  const id = str(input, "id");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Assets operation. Each domain function enforces its OWN permission, state machine
// and segregation of duties (a requester can never approve their own transfer, disposal, run or adjustment).
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return assetsMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveAssetSettings(client, context, input) };
        case "category-save":
          return { record: await saveAssetCategory(client, context, input) };
        case "location-save":
          return { record: await saveAssetLocation(client, context, input) };
        case "asset-register":
          return { record: await registerAsset(client, context, input) };
        case "asset-update":
          return {
            record: await updateAssetRecord(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "asset-from-source":
          return {
            record: await createAssetFromSource(client, context, input),
          };
        case "asset-capitalize":
          return {
            record: await capitalizeAssetRecord(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "asset-assign":
          return {
            record: await assignAssetToCustodian(
              client,
              context,
              str(input, "assetId") || idOf(input),
              input,
            ),
          };
        case "asset-return":
          return {
            record: await returnAsset(
              client,
              context,
              str(input, "assetId") || idOf(input),
              input,
            ),
          };
        case "transfer-request":
          return {
            record: await requestAssetTransfer(
              client,
              context,
              str(input, "assetId"),
              input,
            ),
          };
        case "transfer-approve":
          return {
            record: await approveAssetTransfer(client, context, idOf(input)),
          };
        case "transfer-reject":
          return {
            record: await rejectAssetTransfer(
              client,
              context,
              idOf(input),
              str(input, "reason"),
            ),
          };
        case "transfer-cancel":
          return {
            record: await cancelAssetTransfer(client, context, idOf(input)),
          };
        case "transfer-complete":
          return {
            record: await completeAssetTransfer(client, context, idOf(input)),
          };
        case "run-create":
          return {
            record: await createDepreciationRun(client, context, input),
          };
        case "run-approve":
          return {
            record: await approveDepreciationRun(client, context, idOf(input)),
          };
        case "run-post":
          return {
            record: await postDepreciationRun(client, context, idOf(input)),
          };
        case "run-reverse":
          return {
            record: await reverseDepreciationRun(
              client,
              context,
              idOf(input),
              str(input, "reason"),
            ),
          };
        case "plan-save":
          return { record: await saveMaintenancePlan(client, context, input) };
        case "plans-generate":
          return {
            record: await generateDueMaintenance(client, context, input),
          };
        case "order-create":
          return {
            record: await createAssetWorkOrder(
              client,
              context,
              str(input, "assetId"),
              input,
            ),
          };
        case "order-start":
          return {
            record: await startAssetWorkOrder(client, context, idOf(input)),
          };
        case "order-hold":
          return {
            record: await holdAssetWorkOrder(
              client,
              context,
              idOf(input),
              str(input, "reason"),
            ),
          };
        case "order-cancel":
          return {
            record: await cancelAssetWorkOrder(
              client,
              context,
              idOf(input),
              str(input, "reason"),
            ),
          };
        case "order-part":
          return {
            record: await addAssetWorkOrderPart(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "order-complete":
          return {
            record: await completeAssetWorkOrder(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "disposal-request":
          return {
            record: await requestAssetDisposal(
              client,
              context,
              str(input, "assetId"),
              input,
            ),
          };
        case "disposal-approve":
          return {
            record: await approveAssetDisposal(client, context, idOf(input)),
          };
        case "disposal-reject":
          return {
            record: await rejectAssetDisposal(
              client,
              context,
              idOf(input),
              str(input, "reason"),
            ),
          };
        case "disposal-cancel":
          return {
            record: await cancelAssetDisposal(client, context, idOf(input)),
          };
        case "disposal-complete":
          return {
            record: await completeAssetDisposal(client, context, idOf(input)),
          };
        default:
          throw new HttpError(404, "Unknown Assets action.");
      }
    },
    200,
    "assets.view",
  );
}
