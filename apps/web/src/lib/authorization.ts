import type { SessionContext, WorkspaceSessionContext } from "@/lib/auth";
import { getSessionContext, requireWorkspace } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import {
  ACCOUNTING_PERMISSIONS,
  BILLING_PERMISSIONS,
  BUSINESS_DATA_PERMISSIONS,
  CORE_PERMISSIONS,
  CRM_PERMISSIONS,
  SALES_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
} from "@vercentlabs/permissions";

export const PERMISSIONS = {
  ...CORE_PERMISSIONS,
  businessDataView: BUSINESS_DATA_PERMISSIONS.view,
  partiesManage: BUSINESS_DATA_PERMISSIONS.partiesManage,
  itemsManage: BUSINESS_DATA_PERMISSIONS.itemsManage,
  inventorySetupManage: BUSINESS_DATA_PERMISSIONS.inventorySetupManage,
  financeSetupManage: BUSINESS_DATA_PERMISSIONS.financeSetupManage,
  businessDataImport: BUSINESS_DATA_PERMISSIONS.import,
  crmView: CRM_PERMISSIONS.view,
  crmLeadsManage: CRM_PERMISSIONS.leadsManage,
  crmOpportunitiesManage: CRM_PERMISSIONS.opportunitiesManage,
  crmActivitiesManage: CRM_PERMISSIONS.activitiesManage,
  crmCampaignsManage: CRM_PERMISSIONS.campaignsManage,
  crmCommunicationsManage: CRM_PERMISSIONS.communicationsManage,
  crmAutomationManage: CRM_PERMISSIONS.automationManage,
  crmCaptureManage: CRM_PERMISSIONS.captureManage,
  crmImport: CRM_PERMISSIONS.import,
  crmExport: CRM_PERMISSIONS.export,
  crmReportsView: CRM_PERMISSIONS.reportsView,
  crmSettingsManage: CRM_PERMISSIONS.settingsManage,
  crmRevenueManage: CRM_PERMISSIONS.revenueManage,
  crmAccountsManage: CRM_PERMISSIONS.accountsManage,
  crmPlaybooksManage: CRM_PERMISSIONS.playbooksManage,
  crmPrivacyManage: CRM_PERMISSIONS.privacyManage,
  crmDataQualityManage: CRM_PERMISSIONS.dataQualityManage,
  crmIntegrationsManage: CRM_PERMISSIONS.integrationsManage,
  crmAiManage: CRM_PERMISSIONS.aiManage,
  crmAnalyticsManage: CRM_PERMISSIONS.analyticsManage,
  crmCustomizationManage: CRM_PERMISSIONS.customizationManage,
  crmPartnersManage: CRM_PERMISSIONS.partnersManage,
  crmFieldSalesManage: CRM_PERMISSIONS.fieldSalesManage,
  salesView: SALES_PERMISSIONS.view,
  salesQuotationCreate: SALES_PERMISSIONS.quotationCreate,
  salesQuotationSend: SALES_PERMISSIONS.quotationSend,
  salesQuotationApprove: SALES_PERMISSIONS.quotationApprove,
  salesQuotationAcceptOnBehalf: SALES_PERMISSIONS.quotationAcceptOnBehalf,
  salesOrderCreate: SALES_PERMISSIONS.orderCreate,
  salesOrderConfirm: SALES_PERMISSIONS.orderConfirm,
  salesOrderApprove: SALES_PERMISSIONS.orderApprove,
  salesOrderAmend: SALES_PERMISSIONS.orderAmend,
  salesOrderHold: SALES_PERMISSIONS.orderHold,
  salesOrderCancel: SALES_PERMISSIONS.orderCancel,
  salesFulfillmentRequest: SALES_PERMISSIONS.fulfillmentRequest,
  salesInvoiceRequest: SALES_PERMISSIONS.invoiceRequest,
  salesPriceOverride: SALES_PERMISSIONS.priceOverride,
  salesMarginView: SALES_PERMISSIONS.marginView,
  salesCreditOverride: SALES_PERMISSIONS.creditOverride,
  salesReportsView: SALES_PERMISSIONS.reportsView,
  salesSettingsManage: SALES_PERMISSIONS.settingsManage,
  accountingView: ACCOUNTING_PERMISSIONS.view,
  accountingJournalCreate: ACCOUNTING_PERMISSIONS.journalCreate,
  accountingJournalSubmit: ACCOUNTING_PERMISSIONS.journalSubmit,
  accountingJournalApprove: ACCOUNTING_PERMISSIONS.journalApprove,
  accountingJournalPost: ACCOUNTING_PERMISSIONS.journalPost,
  accountingJournalReverse: ACCOUNTING_PERMISSIONS.journalReverse,
  accountingReceivablesManage: ACCOUNTING_PERMISSIONS.receivablesManage,
  accountingReceivablesApprove: ACCOUNTING_PERMISSIONS.receivablesApprove,
  accountingReceiptsManage: ACCOUNTING_PERMISSIONS.receiptsManage,
  accountingCollectionsManage: ACCOUNTING_PERMISSIONS.collectionsManage,
  accountingPayablesManage: ACCOUNTING_PERMISSIONS.payablesManage,
  accountingPayablesApprove: ACCOUNTING_PERMISSIONS.payablesApprove,
  accountingPaymentsManage: ACCOUNTING_PERMISSIONS.paymentsManage,
  accountingPaymentsApprove: ACCOUNTING_PERMISSIONS.paymentsApprove,
  accountingBankManage: ACCOUNTING_PERMISSIONS.bankManage,
  accountingBankReconcile: ACCOUNTING_PERMISSIONS.bankReconcile,
  accountingPeriodManage: ACCOUNTING_PERMISSIONS.periodManage,
  accountingCloseManage: ACCOUNTING_PERMISSIONS.closeManage,
  accountingBudgetManage: ACCOUNTING_PERMISSIONS.budgetManage,
  accountingTaxManage: ACCOUNTING_PERMISSIONS.taxManage,
  accountingFxManage: ACCOUNTING_PERMISSIONS.fxManage,
  accountingIntercompanyManage: ACCOUNTING_PERMISSIONS.intercompanyManage,
  accountingAssetsManage: ACCOUNTING_PERMISSIONS.assetsManage,
  accountingRecurringManage: ACCOUNTING_PERMISSIONS.recurringManage,
  accountingConsolidationManage: ACCOUNTING_PERMISSIONS.consolidationManage,
  accountingReportsView: ACCOUNTING_PERMISSIONS.reportsView,
  accountingSettingsManage: ACCOUNTING_PERMISSIONS.settingsManage,
  accountingAuditView: ACCOUNTING_PERMISSIONS.auditView,
  procurementView: PROCUREMENT_PERMISSIONS.view,
  procurementSettingsManage: PROCUREMENT_PERMISSIONS.settingsManage,
  procurementSuppliersView: PROCUREMENT_PERMISSIONS.suppliersView,
  procurementSuppliersManage: PROCUREMENT_PERMISSIONS.suppliersManage,
  procurementRequisitionCreate: PROCUREMENT_PERMISSIONS.requisitionCreate,
  procurementRequisitionApprove: PROCUREMENT_PERMISSIONS.requisitionApprove,
  procurementSourcingManage: PROCUREMENT_PERMISSIONS.sourcingManage,
  procurementSourcingAward: PROCUREMENT_PERMISSIONS.sourcingAward,
  procurementContractsManage: PROCUREMENT_PERMISSIONS.contractsManage,
  procurementPoCreate: PROCUREMENT_PERMISSIONS.poCreate,
  procurementPoApprove: PROCUREMENT_PERMISSIONS.poApprove,
  procurementReceiptsManage: PROCUREMENT_PERMISSIONS.receiptsManage,
  procurementMatchingManage: PROCUREMENT_PERMISSIONS.matchingManage,
  procurementReportsView: PROCUREMENT_PERMISSIONS.reportsView,
  billingView: BILLING_PERMISSIONS.view,
  billingManage: BILLING_PERMISSIONS.manage,
  billingCheckout: BILLING_PERMISSIONS.checkout,
  billingAudit: BILLING_PERMISSIONS.audit,
} as const;

export function hasPermission(session: SessionContext, permission: string) {
  return (
    session.roleSlugs.includes("organization_owner") ||
    session.permissions.includes(permission)
  );
}

export async function requirePermission(permission: string) {
  const session = await requireWorkspace();
  if (!hasPermission(session, permission))
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
    );
  return session;
}

export async function requireApiPermission(
  permission: string,
): Promise<WorkspaceSessionContext> {
  const session = await getSessionContext();
  if (!session) throw new HttpError(401, "Authentication is required.");
  if (!session.emailVerified) {
    throw new HttpError(403, "Verify your email before using this workspace.");
  }
  if (!session.organizationId) {
    throw new HttpError(409, "Complete organisation onboarding first.");
  }
  if (!hasPermission(session, permission)) {
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
    );
  }
  return session as WorkspaceSessionContext;
}

export function requirePermissionFromSession(
  session: SessionContext,
  permission: string,
) {
  if (!hasPermission(session, permission))
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
    );
}
