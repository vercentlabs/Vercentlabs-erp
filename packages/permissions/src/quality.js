export const QUALITY_PERMISSIONS = Object.freeze({
  view: "quality.view",
  manage: "quality.manage",
  planManage: "quality.plan.manage",
  inspect: "quality.inspect",
  release: "quality.release",
  hold: "quality.hold",
  nonconformanceManage: "quality.nonconformance.manage",
  // Nonconformance (as migration 0207 grants).
  nonconformanceView: "quality.nonconformance.view", nonconformanceVerify: "quality.nonconformance.verify", nonconformanceClose: "quality.nonconformance.close",
  nonconformanceExport: "quality.nonconformance.export",
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
  // Incoming Inspection and Quality disposition (as migration 0203 grants).
  incomingView: "quality.incoming.view", incomingCreate: "quality.incoming.create", incomingAssign: "quality.incoming.assign", incomingStart: "quality.incoming.start",
  incomingRecord: "quality.incoming.record_result", incomingSubmit: "quality.incoming.submit", incomingReview: "quality.incoming.review", incomingRequestChanges: "quality.incoming.request_changes",
  incomingComplete: "quality.incoming.complete", incomingReinspect: "quality.incoming.reinspect", incomingCorrect: "quality.incoming.correct", incomingCancel: "quality.incoming.cancel",
  incomingExport: "quality.incoming.export", incomingViewAudit: "quality.incoming.view_audit", dispositionApprove: "quality.disposition.approve", dispositionWaive: "quality.disposition.waive",
  // In-Process Inspection (as migration 0204 grants).
  inprocessView: "quality.inprocess.view", inprocessCreate: "quality.inprocess.create", inprocessAssign: "quality.inprocess.assign", inprocessStart: "quality.inprocess.start",
  inprocessRecord: "quality.inprocess.record_result", inprocessSubmit: "quality.inprocess.submit", inprocessReview: "quality.inprocess.review", inprocessRequestChanges: "quality.inprocess.request_changes",
  inprocessComplete: "quality.inprocess.complete", inprocessReinspect: "quality.inprocess.reinspect", inprocessCorrect: "quality.inprocess.correct", inprocessCancel: "quality.inprocess.cancel",
  inprocessExport: "quality.inprocess.export", inprocessViewAudit: "quality.inprocess.view_audit",
  // Final Inspection (as migration 0205 grants).
  finalView: "quality.final.view", finalCreate: "quality.final.create", finalAssign: "quality.final.assign", finalStart: "quality.final.start",
  finalRecord: "quality.final.record_result", finalSubmit: "quality.final.submit", finalReview: "quality.final.review", finalRequestChanges: "quality.final.request_changes",
  finalComplete: "quality.final.complete", finalReinspect: "quality.final.reinspect", finalCorrect: "quality.final.correct", finalCancel: "quality.final.cancel",
  finalExport: "quality.final.export", finalViewAudit: "quality.final.view_audit",
  // Inspection Linked to Delivery (as migration 0206 grants).
  dispatchView: "quality.dispatch.view", dispatchCreate: "quality.dispatch.create", dispatchAssign: "quality.dispatch.assign", dispatchStart: "quality.dispatch.start",
  dispatchRecord: "quality.dispatch.record_result", dispatchSubmit: "quality.dispatch.submit", dispatchReview: "quality.dispatch.review", dispatchRequestChanges: "quality.dispatch.request_changes",
  dispatchComplete: "quality.dispatch.complete", dispatchReinspect: "quality.dispatch.reinspect", dispatchCorrect: "quality.dispatch.correct", dispatchCancel: "quality.dispatch.cancel",
  dispatchExport: "quality.dispatch.export", dispatchViewAudit: "quality.dispatch.view_audit",
});
