import {
  amendAssetDisposal, approveAssetDisposal, cancelAssetDisposal, completeAssetDisposal, confirmDisposalHandover, correctAssetDisposal, linkDisposalSaleInvoice, postAssetDerecognition, prepareAssetDerecognition,
  recoverAssetDisposal, rejectAssetDisposal, submitAssetDisposal, unlinkDisposalSaleInvoice, updateAssetDisposalCase, allocateAssetSaleProceeds, configureAssetSale, configureAssetScrap,
  createDisposalSaleInvoice, dispatchDisposalAsset, recordScrapEvidence, adjustDisposalResult, linkDisposalCost, recalculateDisposalPreview, recordDisposalInsuranceClaim,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST recalculate-financials · approve-financials · link-cost · record-insurance-claim · adjust-result ·
// sale-details · scrap-details · allocate-proceeds · create-sale-invoice · dispatch · record-scrap-evidence ·
// edit · submit · approve · reject · amend · confirm-handover · link-sale-invoice · unlink-sale-invoice · prepare-derecognition · post-derecognition · recover · complete · cancel · correct
type Params = { params: Promise<{ caseId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { caseId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "edit": return updateAssetDisposalCase(client, context, caseId, input);
      case "submit": return submitAssetDisposal(client, context, caseId, input);
      case "approve": return approveAssetDisposal(client, context, caseId, input);
      case "reject": return rejectAssetDisposal(client, context, caseId, input);
      case "amend": return amendAssetDisposal(client, context, caseId, input);
      case "confirm-handover": return confirmDisposalHandover(client, context, caseId, input);
      case "link-sale-invoice": return linkDisposalSaleInvoice(client, context, caseId, input);
      case "unlink-sale-invoice": return unlinkDisposalSaleInvoice(client, context, caseId, input);
      case "prepare-derecognition": return prepareAssetDerecognition(client, context, caseId, input);
      case "post-derecognition": return postAssetDerecognition(client, context, caseId, input);
      case "recover": return recoverAssetDisposal(client, context, caseId, input);
      case "complete": return completeAssetDisposal(client, context, caseId, input);
      case "cancel": return cancelAssetDisposal(client, context, caseId, input);
      case "correct": return correctAssetDisposal(client, context, caseId, input);
      case "sale-details": return configureAssetSale(client, context, caseId, input);
      case "scrap-details": return configureAssetScrap(client, context, caseId, input);
      case "allocate-proceeds": return allocateAssetSaleProceeds(client, context, caseId, input);
      case "create-sale-invoice": return createDisposalSaleInvoice(client, context, caseId, input);
      case "dispatch": return dispatchDisposalAsset(client, context, caseId, input);
      case "record-scrap-evidence": return recordScrapEvidence(client, context, caseId, input);
      case "recalculate-financials": return recalculateDisposalPreview(client, context, caseId, input);
      case "approve-financials": return prepareAssetDerecognition(client, context, caseId, input);
      case "link-cost": return linkDisposalCost(client, context, caseId, input);
      case "record-insurance-claim": return recordDisposalInsuranceClaim(client, context, caseId, input);
      case "adjust-result": return adjustDisposalResult(client, context, caseId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
