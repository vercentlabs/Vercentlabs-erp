import { z } from "zod";

import {
  saveQualitySettings, saveSamplingPlan, defineQualityPlan, approveQualityPlan, reviseQualityPlan, retireQualityPlan,
  createQualityInspection, recordInspectionResults, completeQualityInspection, releaseQualityInspection, cancelQualityInspection,
  createQualityHold, cancelQualityHold, releaseQualityHold,
  createQualityNonconformance, transitionNonconformance, setDisposition, approveUseAsIs, closeNonconformance, cancelNonconformance,
  createQualityCapa, recordRootCause, recordCapaActions, submitCapaForVerification, verifyCapa, closeCapa,
  recomputeSupplierQualityRecord, saveAudit, startAudit, addAuditFinding, linkFindingCapa, closeAuditFinding, completeAudit,
  recordCalibration, markOverdueCalibrations, saveCertificate, issueCertificate, voidCertificate,
  saveQualityDocument, submitQualityDocument, approveQualityDocument, reviseQualityDocument, obsoleteQualityDocument,
  createCustomerComplaint, investigateComplaint, resolveComplaint, closeComplaint,
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
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return qualityMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveQualitySettings(client, context, input) };
        case "sampling-plan-save":
          return { record: await saveSamplingPlan(client, context, input) };
        case "plan-create":
          return { record: await defineQualityPlan(client, context, input) };
        case "plan-approve":
          return { record: await approveQualityPlan(client, context, idOf(input)) };
        case "plan-revise":
          return { record: await reviseQualityPlan(client, context, idOf(input)) };
        case "plan-retire":
          return { record: await retireQualityPlan(client, context, idOf(input), String(input.reason ?? "")) };
        case "inspection-create":
          return { record: await createQualityInspection(client, context, input) };
        case "inspection-results":
          return { record: await recordInspectionResults(client, context, idOf(input), input) };
        case "inspection-complete":
          return { record: await completeQualityInspection(client, context, idOf(input), input) };
        case "inspection-release":
          return { record: await releaseQualityInspection(client, context, idOf(input), input) };
        case "inspection-cancel":
          return { record: await cancelQualityInspection(client, context, idOf(input), String(input.reason ?? "")) };
        case "hold-create":
          return { record: await createQualityHold(client, context, input) };
        case "hold-cancel":
          return { record: await cancelQualityHold(client, context, idOf(input), String(input.reason ?? "")) };
        case "hold-release":
          // Crossing into this folder's original, more strictly typed index.d.ts declaration for the
          // one legacy function reused as-is; the domain itself validates the shape at runtime.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { record: await releaseQualityHold(client, context, idOf(input), input as any) };
        case "nc-create":
          return { record: await createQualityNonconformance(client, context, input) };
        case "nc-transition":
          return { record: await transitionNonconformance(client, context, idOf(input), input) };
        case "nc-disposition":
          return { record: await setDisposition(client, context, idOf(input), input) };
        case "nc-use-as-is-decide":
          return { record: await approveUseAsIs(client, context, idOf(input), input) };
        case "nc-close":
          return { record: await closeNonconformance(client, context, idOf(input), input) };
        case "nc-cancel":
          return { record: await cancelNonconformance(client, context, idOf(input), String(input.reason ?? "")) };
        case "capa-create":
          return { record: await createQualityCapa(client, context, input) };
        case "capa-root-cause":
          return { record: await recordRootCause(client, context, idOf(input), input) };
        case "capa-actions":
          return { record: await recordCapaActions(client, context, idOf(input), input) };
        case "capa-submit-verification":
          return { record: await submitCapaForVerification(client, context, idOf(input)) };
        case "capa-verify":
          return { record: await verifyCapa(client, context, idOf(input), input) };
        case "capa-close":
          return { record: await closeCapa(client, context, idOf(input)) };
        case "supplier-record-recompute":
          return { record: await recomputeSupplierQualityRecord(client, context, input) };
        case "audit-save":
          return { record: await saveAudit(client, context, input) };
        case "audit-start":
          return { record: await startAudit(client, context, idOf(input)) };
        case "audit-finding-add":
          return { record: await addAuditFinding(client, context, String(input.auditId ?? ""), input) };
        case "audit-finding-link-capa":
          return { record: await linkFindingCapa(client, context, String(input.findingId ?? ""), String(input.capaId ?? "")) };
        case "audit-finding-close":
          return { record: await closeAuditFinding(client, context, String(input.findingId ?? "")) };
        case "audit-complete":
          return { record: await completeAudit(client, context, idOf(input), input) };
        case "calibration-record":
          return { record: await recordCalibration(client, context, input) };
        case "calibration-sweep-overdue":
          return { record: await markOverdueCalibrations(client, context) };
        case "certificate-save":
          return { record: await saveCertificate(client, context, input) };
        case "certificate-issue":
          return { record: await issueCertificate(client, context, idOf(input)) };
        case "certificate-void":
          return { record: await voidCertificate(client, context, idOf(input), String(input.reason ?? "")) };
        case "document-save":
          return { record: await saveQualityDocument(client, context, input) };
        case "document-submit":
          return { record: await submitQualityDocument(client, context, idOf(input)) };
        case "document-approve":
          return { record: await approveQualityDocument(client, context, idOf(input)) };
        case "document-revise":
          return { record: await reviseQualityDocument(client, context, idOf(input)) };
        case "document-obsolete":
          return { record: await obsoleteQualityDocument(client, context, idOf(input), String(input.reason ?? "")) };
        case "complaint-create":
          return { record: await createCustomerComplaint(client, context, input) };
        case "complaint-investigate":
          return { record: await investigateComplaint(client, context, idOf(input), input) };
        case "complaint-resolve":
          return { record: await resolveComplaint(client, context, idOf(input), input) };
        case "complaint-close":
          return { record: await closeComplaint(client, context, idOf(input)) };
        default:
          throw new HttpError(404, "Unknown Quality action.");
      }
    },
    200,
    "quality.view",
  );
}
