export const QUALITY_PERMISSIONS = Object.freeze({
  view: "quality.view",
  manage: "quality.manage",
  planManage: "quality.plan.manage",
  inspect: "quality.inspect",
  release: "quality.release",
  hold: "quality.hold",
  nonconformanceManage: "quality.nonconformance.manage",
  capaManage: "quality.capa.manage",
  samplingManage: "quality.sampling.manage",
  supplierQualityManage: "quality.supplier.manage",
  auditManage: "quality.audit.manage",
  reportsView: "quality.reports.view",
  settingsManage: "quality.settings.manage",
  auditView: "quality.audit.view",
  // Inspection Specifications (as migration 0162 grants).
  specView: "quality.spec.view", specCreate: "quality.spec.create", specEditDraft: "quality.spec.edit_draft", specCopy: "quality.spec.copy", specSubmit: "quality.spec.submit",
  specReview: "quality.spec.review", specApprove: "quality.spec.approve", specActivate: "quality.spec.activate", specRevise: "quality.spec.revise", specRetire: "quality.spec.retire",
  specManageApplicability: "quality.spec.manage_applicability", specViewHistory: "quality.spec.view_history", specExport: "quality.spec.export", specViewEvidence: "quality.spec.view_evidence",
  // Quality Control Points (as migration 0163 grants).
  qcpView: "quality.qcp.view", qcpCreate: "quality.qcp.create", qcpEditDraft: "quality.qcp.edit_draft", qcpCopy: "quality.qcp.copy", qcpSubmit: "quality.qcp.submit", qcpReview: "quality.qcp.review",
  qcpApprove: "quality.qcp.approve", qcpActivate: "quality.qcp.activate", qcpRevise: "quality.qcp.revise", qcpRetire: "quality.qcp.retire", qcpManageGate: "quality.qcp.manage_gate",
  qcpRequestWaiver: "quality.qcp.request_waiver", qcpApproveWaiver: "quality.qcp.approve_waiver", qcpReevaluate: "quality.qcp.reevaluate", qcpViewHistory: "quality.qcp.view_history", qcpExport: "quality.qcp.export",
});
