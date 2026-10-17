import {
  allocateAssetAcquisition, archiveAsset, getAssetAssignmentPanel, getAssetCapitalization, getAssetTransferPanel, getAssetOpening, getAssetCustody, getAssetCustodyHistory, requestCustodyHandover, requestCustodyReturn, returnAssetCustody, closeAssetMissingReport, correctAssetLocation, correctAssetSerial, endAssetLocationObservation, getAssetLocationView, recordAssetLocationObservation, getAssetIdentification, getAssetIdentifierHistory, getAssetLabel, getAssetReclassifications, getAssetStatus,
  getAssetStatusHistory, getAssetView, previewAssetReclassification, reclassifyAsset, recordAssetCondition, recordAssetVerification, replaceAssetTag, reportMissingAsset, setAssetLegacyCode, transitionAsset,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET acquisition · financials · custody · warranty · verification · activity · label · reclassifications · identification · identifier-history · status · status-history · location · custody-current · custody-history · opening · capitalization · transfers · assignments
// POST register · activate { availableForUseDate? } · hold { reasonCode, description, resolutionOwnerId? } · release { reason } · retire { reason, custodyReviewed?, retiredOn? }
//      · confirm-lost { note } · recover { recoveredOn, condition, locationId, custodianUserId?, identityConfirmed, note? } · reinstate { reason, suitabilityConfirmed, locationId? }
//      — each with expectedVersion? and idempotencyKey? · report-missing { description, missingSince? } · close-missing { note } · condition { condition, observedOn?, reason? } · archive { reason }
//      · custody-handover { toType, userId?|departmentId?|storeLocationId?, condition?, expectedReturnAt?, handOverNow? } · custody-return { toType, …, condition, identityVerified } · custody-request-return
//      · location-observation { kind, locationId? | locationText?, reason, expiresAt?, flagDiscrepancy? } · location-observation-end · location-correction { locationId, reason }
//      · verify { outcome, observedLocationId?, observedLocationText?, condition?, note?, method? } · acquisition { sourceType, sourceLineId?, reason?, openingCost? }
//      · reclassify-preview { toCategoryId } · reclassify { toCategoryId, reason, idempotencyKey? }
//      · serial { serialNumber, reason, expectedVersion?, duplicateException? } · tag { tagCode, reason, expectedVersion? } · legacy-code { legacyCode, reason, expectedVersion? }
type Params = { params: Promise<{ id: string; view: string }> };
const LIFECYCLE = ["register", "activate", "hold", "release", "retire", "confirm-lost", "recover", "reinstate"];
export async function GET(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return assetsRead(request, async (client, context) => {
    if (view === "label") return getAssetLabel(client, context, id);
    if (view === "reclassifications") return getAssetReclassifications(client, context, { assetId: id });
    if (view === "identification") return getAssetIdentification(client, context, id);
    if (view === "identifier-history") return getAssetIdentifierHistory(client, context, id);
    if (view === "status") return getAssetStatus(client, context, id);
    if (view === "status-history") return getAssetStatusHistory(client, context, id);
    if (view === "location") return getAssetLocationView(client, context, id);
    if (view === "custody-current") return getAssetCustody(client, context, id);
    if (view === "custody-history") return getAssetCustodyHistory(client, context, id);
    if (view === "opening") return getAssetOpening(client, context, id);
    if (view === "capitalization") return getAssetCapitalization(client, context, id);
    if (view === "transfers") return getAssetTransferPanel(client, context, id);
    if (view === "assignments") return getAssetAssignmentPanel(client, context, id);
    return getAssetView(client, context, id, view);
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (LIFECYCLE.includes(view)) return transitionAsset(client, context, id, view, input);
    if (view === "archive") return archiveAsset(client, context, id, input);
    if (view === "verify") return recordAssetVerification(client, context, id, input);
    if (view === "acquisition") return allocateAssetAcquisition(client, context, id, input);
    if (view === "reclassify-preview") return previewAssetReclassification(client, context, id, input);
    if (view === "reclassify") return reclassifyAsset(client, context, id, input);
    if (view === "serial") return correctAssetSerial(client, context, id, input);
    if (view === "tag") return replaceAssetTag(client, context, id, input);
    if (view === "legacy-code") return setAssetLegacyCode(client, context, id, input);
    if (view === "report-missing") return reportMissingAsset(client, context, id, input);
    if (view === "close-missing") return closeAssetMissingReport(client, context, id, input);
    if (view === "condition") return recordAssetCondition(client, context, id, input);
    if (view === "location-observation") return recordAssetLocationObservation(client, context, id, input);
    if (view === "location-observation-end") return endAssetLocationObservation(client, context, id);
    if (view === "location-correction") return correctAssetLocation(client, context, id, input);
    if (view === "custody-handover") return requestCustodyHandover(client, context, id, input);
    if (view === "custody-return") return returnAssetCustody(client, context, id, input);
    if (view === "custody-request-return") return requestCustodyReturn(client, context, id, input);
    throw new HttpError(404, "Unknown asset action.", "NOT_FOUND");
  });
}
