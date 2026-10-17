export const ASSET_PERMISSIONS = Object.freeze({
  view: "assets.view",
  // Asset Register (0143).
  editDraft: "assets.edit_draft", editDetails: "assets.edit_details", registerBulk: "assets.register_bulk", import: "assets.import", export: "assets.export",
  activate: "assets.activate", verify: "assets.verify", viewFinancials: "assets.view_financials", manageAcquisitionLink: "assets.manage_acquisition_link",
  retireOrDispose: "assets.retire_or_dispose", manageCategories: "assets.manage_categories",
  // Asset Categories (0144).
  categoryCreate: "assets.category.create", categoryEdit: "assets.category.edit", categoryDeactivate: "assets.category.deactivate",
  categoryReclassify: "assets.category.reclassify", categoryManageFinancialPolicy: "assets.category.manage_financial_policy", categoryViewFinancialPolicy: "assets.category.view_financial_policy",
  categoryExport: "assets.category.export", categoryViewHistory: "assets.category.view_history",
  // Asset Identification and Code (0145).
  identificationEditSerial: "assets.identification.edit_serial", identificationEditTag: "assets.identification.edit_tag", identificationImport: "assets.identification.import",
  identificationPrintLabel: "assets.identification.print_label", identificationBulkPrint: "assets.identification.bulk_print", identificationViewHistory: "assets.identification.view_history",
  identificationResolveDuplicate: "assets.identification.resolve_duplicate", identificationExport: "assets.identification.export",
  // Asset Status (0146).
  statusPlaceHold: "assets.status.place_hold", statusReleaseHold: "assets.status.release_hold", statusReportMissing: "assets.status.report_missing", statusConfirmLost: "assets.status.confirm_lost",
  statusRecover: "assets.status.recover", statusReinstate: "assets.status.reinstate", statusConditionUpdate: "assets.status.condition_update", statusViewHistory: "assets.status.view_history",
  statusBulkAction: "assets.status.bulk_action",
  // Asset Location (0147).
  locationCreate: "assets.location.create", locationEdit: "assets.location.edit", locationDeactivate: "assets.location.deactivate", locationManageHierarchy: "assets.location.manage_hierarchy",
  locationViewHistory: "assets.location.view_history", locationRecordObservation: "assets.location.record_observation", locationReviewDiscrepancy: "assets.location.review_discrepancy", locationExport: "assets.location.export",
  // Custodian (0148).
  custodyAssign: "assets.custody.assign", custodyReassign: "assets.custody.reassign", custodyReturn: "assets.custody.return", custodyAcknowledge: "assets.custody.acknowledge",
  custodyDispute: "assets.custody.dispute", custodyBulkManage: "assets.custody.bulk_manage", custodyViewHistory: "assets.custody.view_history", custodyManageExceptions: "assets.custody.manage_exceptions",
  custodyViewClearance: "assets.custody.view_clearance", custodyExport: "assets.custody.export",
  // Opening / Existing Assets (0149).
  openingCreate: "assets.opening.create", openingUpload: "assets.opening.upload", openingEditDraft: "assets.opening.edit_draft", openingValidate: "assets.opening.validate",
  openingRegister: "assets.opening.register", openingViewFinancials: "assets.opening.view_financials", openingApproveFinancials: "assets.opening.approve_financials", openingClose: "assets.opening.close",
  openingCorrect: "assets.opening.correct", openingExport: "assets.opening.export", openingViewAudit: "assets.opening.view_audit",
  // Purchase and Capitalization (0150).
  acquisitionView: "assets.acquisition.view", acquisitionRegister: "assets.acquisition.register", acquisitionBulkRegister: "assets.acquisition.bulk_register",
  acquisitionAllocateCost: "assets.acquisition.allocate_cost", acquisitionViewCost: "assets.acquisition.view_cost", capitalizationRequest: "assets.capitalization.request",
  capitalizationReview: "assets.capitalization.review", capitalizationApprove: "assets.capitalization.approve", capitalizationPost: "assets.capitalization.post",
  capitalizationAdjust: "assets.capitalization.adjust", cwipManage: "assets.cwip.manage", acquisitionReconcile: "assets.acquisition.reconcile", acquisitionExport: "assets.acquisition.export",
  acquisitionViewAudit: "assets.acquisition.view_audit",
  // Purchase Invoice-to-Asset Creation (0151).
  invoiceViewSource: "assets.invoice.view_source", invoiceCreate: "assets.invoice.create", invoiceBulkCreate: "assets.invoice.bulk_create", invoiceViewCost: "assets.invoice.view_cost",
  invoiceReconcile: "assets.invoice.reconcile", invoiceViewHistory: "assets.invoice.view_history", invoiceExport: "assets.invoice.export",
  // Asset Transfers (0152).
  transferView: "assets.transfer.view", transferCreate: "assets.transfer.create", transferSubmit: "assets.transfer.submit", transferApprove: "assets.transfer.approve",
  transferReject: "assets.transfer.reject", transferDispatch: "assets.transfer.dispatch", transferReceive: "assets.transfer.receive", transferComplete: "assets.transfer.complete",
  transferCancel: "assets.transfer.cancel", transferReportException: "assets.transfer.report_exception", transferManageException: "assets.transfer.manage_exception",
  transferBulkManage: "assets.transfer.bulk_manage", transferViewHistory: "assets.transfer.view_history", transferExport: "assets.transfer.export",
  // Asset Assignment (0153).
  assignmentView: "assets.assignment.view", assignmentRequest: "assets.assignment.request", assignmentApprove: "assets.assignment.approve", assignmentIssue: "assets.assignment.issue",
  assignmentReturn: "assets.assignment.return", assignmentExtend: "assets.assignment.extend", assignmentBulk: "assets.assignment.bulk", assignmentManageException: "assets.assignment.manage_exception",
  assignmentViewHistory: "assets.assignment.view_history", assignmentExport: "assets.assignment.export",
  // Asset Movement History (0154).
  movementView: "assets.movement.view", movementViewHistory: "assets.movement.view_history", movementViewEvidence: "assets.movement.view_evidence",
  movementViewCustody: "assets.movement.view_custody", movementViewAudit: "assets.movement.view_audit", movementExport: "assets.movement.export",
  movementReconcile: "assets.movement.reconcile", movementRequestCorrection: "assets.movement.request_correction",
  // Straight-Line Depreciation (0155).
  depreciationView: "assets.depreciation.view", depreciationViewFinancials: "assets.depreciation.view_financials", depreciationManagePolicy: "assets.depreciation.manage_policy",
  depreciationAssignPolicy: "assets.depreciation.assign_policy", depreciationGenerate: "assets.depreciation.generate", depreciationPrepareRun: "assets.depreciation.prepare_run",
  depreciationReview: "assets.depreciation.review", depreciationApprove: "assets.depreciation.approve", depreciationPost: "assets.depreciation.post",
  depreciationReviseEstimate: "assets.depreciation.revise_estimate", depreciationCorrect: "assets.depreciation.correct", depreciationReconcile: "assets.depreciation.reconcile",
  depreciationExport: "assets.depreciation.export", depreciationViewAudit: "assets.depreciation.view_audit",
  // Automatic Depreciation Accounting (0157).
  depreciationAutomationView: "assets.depreciation.automation_view", depreciationAutomationConfigure: "assets.depreciation.automation_configure",
  depreciationAutomationEnable: "assets.depreciation.automation_enable", depreciationRetry: "assets.depreciation.retry",
  // Asset Maintenance (0158).
  maintenanceView: "assets.maintenance.view", maintenanceRequest: "assets.maintenance.request", maintenanceTriage: "assets.maintenance.triage",
  maintenanceCreateWorkOrder: "assets.maintenance.create_work_order", maintenanceAssign: "assets.maintenance.assign", maintenanceApprove: "assets.maintenance.approve",
  maintenanceSchedule: "assets.maintenance.schedule", maintenanceExecute: "assets.maintenance.execute", maintenanceRecordParts: "assets.maintenance.record_parts",
  maintenanceViewCost: "assets.maintenance.view_cost", maintenanceComplete: "assets.maintenance.complete", maintenanceVerify: "assets.maintenance.verify",
  maintenanceRelease: "assets.maintenance.release", maintenanceManagePlans: "assets.maintenance.manage_plans", maintenanceCancel: "assets.maintenance.cancel",
  maintenanceReopen: "assets.maintenance.reopen", maintenanceExport: "assets.maintenance.export", maintenanceViewAudit: "assets.maintenance.view_audit",
  // Asset Disposal (0159).
  disposalView: "assets.disposal.view", disposalCreate: "assets.disposal.create", disposalSubmit: "assets.disposal.submit", disposalApprove: "assets.disposal.approve",
  disposalReject: "assets.disposal.reject", disposalConfirmHandover: "assets.disposal.confirm_handover", disposalViewFinancials: "assets.disposal.view_financials",
  disposalFinanceReview: "assets.disposal.finance_review", disposalRequestDerecognition: "assets.disposal.request_derecognition", disposalComplete: "assets.disposal.complete",
  disposalCancel: "assets.disposal.cancel", disposalCorrect: "assets.disposal.correct", disposalBulk: "assets.disposal.bulk", disposalReconcile: "assets.disposal.reconcile",
  disposalExport: "assets.disposal.export", disposalViewAudit: "assets.disposal.view_audit",
  // Asset Sale / Scrap (0160).
  disposalManageSale: "assets.disposal.manage_sale", disposalManageScrap: "assets.disposal.manage_scrap", disposalRecordEvidence: "assets.disposal.record_evidence",
  manage: "assets.manage",
  create: "assets.create",
  capitalize: "assets.capitalize",
  assign: "assets.assign",
  transfer: "assets.transfer",
  maintain: "assets.maintain",
  inspect: "assets.inspect",
  depreciate: "assets.depreciate",
  dispose: "assets.dispose",
  accountingHandoff: "assets.accounting.handoff",
  reportsView: "assets.reports.view",
  settingsManage: "assets.settings.manage",
  auditView: "assets.audit.view",
});
