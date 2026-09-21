import { z } from "zod";

import {
  addAssetDocument, addAssetWorkOrderPart, approveAssetDisposal, approveAssetTransfer, approveDepreciationRun, approveValueAdjustment, assignAssetToCustodian, cancelAssetDisposal,
  cancelAssetTransfer, cancelAssetVerificationCampaign, cancelAssetWorkOrder, cancelValueAdjustment, capitalizeAssetRecord, closeAssetVerificationCampaign, completeAssetDisposal,
  completeAssetTransfer, completeAssetWorkOrder, createAssetFromSource, createAssetVerificationCampaign, createAssetWarrantyClaim, createAssetWorkOrder, createDepreciationRun,
  endAssetDowntime, generateDueMaintenance, holdAssetWorkOrder, postDepreciationRun, recordAssetCalibration, recordAssetDowntime, recordAssetInspection, recordAssetUsage,
  registerAsset, rejectAssetDisposal, rejectAssetTransfer, rejectValueAdjustment, removeAssetDocument, requestAssetDisposal, requestAssetTransfer, requestValueAdjustment,
  resolveAssetDiscrepancy, returnAsset, reverseDepreciationRun, saveAssetCategory, saveAssetLocation, saveAssetSettings, saveAssetWarranty, saveMaintenancePlan,
  scanAssetForVerification, startAssetVerificationCampaign, startAssetWorkOrder, updateAssetRecord, updateAssetWarrantyClaim,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const str = (input: Record<string, unknown>, key: string) => String(input[key] ?? "");
const idOf = (input: Record<string, unknown>) => {
  const id = str(input, "id");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Assets operation. Each domain function enforces its OWN permission, state machine
// and segregation of duties (a requester can never approve their own transfer, disposal, run or adjustment).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
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
          return { record: await updateAssetRecord(client, context, idOf(input), input) };
        case "asset-from-source":
          return { record: await createAssetFromSource(client, context, input) };
        case "asset-capitalize":
          return { record: await capitalizeAssetRecord(client, context, idOf(input), input) };
        case "document-add":
          return { record: await addAssetDocument(client, context, str(input, "assetId"), input) };
        case "document-remove":
          return { record: await removeAssetDocument(client, context, idOf(input)) };
        case "asset-assign":
          return { record: await assignAssetToCustodian(client, context, str(input, "assetId") || idOf(input), input) };
        case "asset-return":
          return { record: await returnAsset(client, context, str(input, "assetId") || idOf(input), input) };
        case "transfer-request":
          return { record: await requestAssetTransfer(client, context, str(input, "assetId"), input) };
        case "transfer-approve":
          return { record: await approveAssetTransfer(client, context, idOf(input)) };
        case "transfer-reject":
          return { record: await rejectAssetTransfer(client, context, idOf(input), str(input, "reason")) };
        case "transfer-cancel":
          return { record: await cancelAssetTransfer(client, context, idOf(input)) };
        case "transfer-complete":
          return { record: await completeAssetTransfer(client, context, idOf(input)) };
        case "usage-record":
          return { record: await recordAssetUsage(client, context, str(input, "assetId"), input) };
        case "run-create":
          return { record: await createDepreciationRun(client, context, input) };
        case "run-approve":
          return { record: await approveDepreciationRun(client, context, idOf(input)) };
        case "run-post":
          return { record: await postDepreciationRun(client, context, idOf(input)) };
        case "run-reverse":
          return { record: await reverseDepreciationRun(client, context, idOf(input), str(input, "reason")) };
        case "adjustment-request":
          return { record: await requestValueAdjustment(client, context, str(input, "assetId"), input) };
        case "adjustment-approve":
          return { record: await approveValueAdjustment(client, context, idOf(input)) };
        case "adjustment-reject":
          return { record: await rejectValueAdjustment(client, context, idOf(input), str(input, "reason")) };
        case "adjustment-cancel":
          return { record: await cancelValueAdjustment(client, context, idOf(input)) };
        case "plan-save":
          return { record: await saveMaintenancePlan(client, context, input) };
        case "plans-generate":
          return { record: await generateDueMaintenance(client, context, input) };
        case "order-create":
          return { record: await createAssetWorkOrder(client, context, str(input, "assetId"), input) };
        case "order-start":
          return { record: await startAssetWorkOrder(client, context, idOf(input)) };
        case "order-hold":
          return { record: await holdAssetWorkOrder(client, context, idOf(input), str(input, "reason")) };
        case "order-cancel":
          return { record: await cancelAssetWorkOrder(client, context, idOf(input), str(input, "reason")) };
        case "order-part":
          return { record: await addAssetWorkOrderPart(client, context, idOf(input), input) };
        case "order-complete":
          return { record: await completeAssetWorkOrder(client, context, idOf(input), input) };
        case "downtime-record":
          return { record: await recordAssetDowntime(client, context, str(input, "assetId"), input) };
        case "downtime-end":
          return { record: await endAssetDowntime(client, context, idOf(input), input.endedAt as string | undefined) };
        case "warranty-save":
          return { record: await saveAssetWarranty(client, context, input) };
        case "claim-create":
          return { record: await createAssetWarrantyClaim(client, context, input) };
        case "claim-update":
          return { record: await updateAssetWarrantyClaim(client, context, idOf(input), input) };
        case "inspection-record":
          return { record: await recordAssetInspection(client, context, str(input, "assetId"), input) };
        case "calibration-record":
          return { record: await recordAssetCalibration(client, context, str(input, "assetId"), input) };
        case "campaign-create":
          return { record: await createAssetVerificationCampaign(client, context, input) };
        case "campaign-start":
          return { record: await startAssetVerificationCampaign(client, context, idOf(input)) };
        case "campaign-scan":
          return { record: await scanAssetForVerification(client, context, str(input, "campaignId"), input) };
        case "campaign-resolve":
          return { record: await resolveAssetDiscrepancy(client, context, idOf(input), input) };
        case "campaign-close":
          return { record: await closeAssetVerificationCampaign(client, context, idOf(input), input) };
        case "campaign-cancel":
          return { record: await cancelAssetVerificationCampaign(client, context, idOf(input)) };
        case "disposal-request":
          return { record: await requestAssetDisposal(client, context, str(input, "assetId"), input) };
        case "disposal-approve":
          return { record: await approveAssetDisposal(client, context, idOf(input)) };
        case "disposal-reject":
          return { record: await rejectAssetDisposal(client, context, idOf(input), str(input, "reason")) };
        case "disposal-cancel":
          return { record: await cancelAssetDisposal(client, context, idOf(input)) };
        case "disposal-complete":
          return { record: await completeAssetDisposal(client, context, idOf(input)) };
        default:
          throw new HttpError(404, "Unknown Assets action.");
      }
    },
    200,
    "assets.view",
  );
}
