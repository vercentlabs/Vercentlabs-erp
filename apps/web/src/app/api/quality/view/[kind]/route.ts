import {
  getQualitySettings, listSamplingPlans, listQualityPlans, getQualityPlan, listInspections, getInspection, listQualityHolds, getQualityHold,
  listNonconformances, getNonconformance, listCapa, getCapa, listSupplierQualityRecords, listAudits, getAudit, listCalibrationRecords,
  listCertificates, listQualityDocuments, listCustomerComplaints, getCustomerComplaint, getBatchTraceability, getQualityCostReport,
  getQualityKpiDashboard, listQualityOptions,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// One read endpoint per Quality screen. Each is gated by quality.view (module-wide) and the domain
// function re-checks its OWN permission.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(async (client, context) => {
    switch (kind) {
      case "options":
        return { options: await listQualityOptions(client, context) };
      case "settings":
        return { settings: await getQualitySettings(client, context) };
      case "plans":
        return { rows: await listQualityPlans(client, context, { planType: get("planType"), status: get("status"), itemId: get("itemId") }) };
      case "plan":
        return { plan: await getQualityPlan(client, context, get("id") ?? "") };
      case "sampling-plans":
        return { rows: await listSamplingPlans(client, context) };
      case "inspections":
        return { rows: await listInspections(client, context, { status: get("status"), sourceType: get("sourceType"), itemId: get("itemId") }) };
      case "inspection":
        return { inspection: await getInspection(client, context, get("id") ?? "") };
      case "holds":
        return { rows: await listQualityHolds(client, context, { status: get("status"), itemId: get("itemId") }) };
      case "hold":
        return { hold: await getQualityHold(client, context, get("id") ?? "") };
      case "nonconformances":
        return { rows: await listNonconformances(client, context, { status: get("status"), severity: get("severity") }) };
      case "nonconformance":
        return { nonconformance: await getNonconformance(client, context, get("id") ?? "") };
      case "capa":
        return { rows: await listCapa(client, context, { status: get("status") }) };
      case "capa-detail":
        return { capa: await getCapa(client, context, get("id") ?? "") };
      case "supplier-records":
        return { rows: await listSupplierQualityRecords(client, context, { supplierId: get("supplierId") }) };
      case "audits":
        return { rows: await listAudits(client, context, { status: get("status") }) };
      case "audit":
        return { audit: await getAudit(client, context, get("id") ?? "") };
      case "calibration":
        return { rows: await listCalibrationRecords(client, context, { status: get("status") }) };
      case "certificates":
        return { rows: await listCertificates(client, context, { status: get("status") }) };
      case "documents":
        return { rows: await listQualityDocuments(client, context, { status: get("status") }) };
      case "complaints":
        return { rows: await listCustomerComplaints(client, context, { status: get("status") }) };
      case "complaint":
        return { complaint: await getCustomerComplaint(client, context, get("id") ?? "") };
      case "traceability":
        return { trace: await getBatchTraceability(client, context, { batchId: get("batchId"), serialId: get("serialId") }) };
      case "cost-report":
        return { report: await getQualityCostReport(client, context, { from: get("from"), to: get("to") }) };
      case "dashboard":
        return { dashboard: await getQualityKpiDashboard(client, context) };
      default:
        throw new HttpError(404, "Unknown Quality view.");
    }
  }, "quality.view");
}
