import type { SessionContext } from "@/lib/auth";
import { requireWorkspace } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import {
  BILLING_PERMISSIONS,
  BUSINESS_DATA_PERMISSIONS,
  CORE_PERMISSIONS,
  CRM_PERMISSIONS,
  SALES_PERMISSIONS,
} from "@vercent/permissions";

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
