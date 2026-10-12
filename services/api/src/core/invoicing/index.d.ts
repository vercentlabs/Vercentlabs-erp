// Shared GST invoicing (migration 0098).
type InvoicingContext = { organizationId: string; userId: string; roleSlugs?: string[]; permissions?: string[] };

export type GstDocumentType = "tax_invoice" | "bill_of_supply" | "invoice_cum_bill_of_supply" | "credit_note" | "debit_note" | "receipt";
export type InvoiceSeriesKind = "tax_invoice" | "bill_of_supply" | "credit_note" | "debit_note";
export type EInvoiceStatus = "not_applicable" | "required" | "ready" | "registration_pending" | "registered" | "failed" | "unknown" | "reconciliation_required";

export declare const INVOICE_MESSAGES: Readonly<Record<string, string>>;
export declare function validateGstin(value: string | null | undefined): { valid: boolean; gstin: string; stateCode: string | null; verified?: false; message: string };
export declare function financialYearOf(day: string, startMonth?: number): string;
export declare function determineRequiredSalesDocument(input: { taxEnabled: boolean; registrationType?: string | null; hasRegistration?: boolean; classifications?: string[] }): {
  documentType: GstDocumentType | null; statutory: boolean; kind: InvoiceSeriesKind | null; unsupported?: true;
};
export declare function evaluateEInvoiceApplicability(input: { registration: Record<string, any> | null; supplyType: "b2b" | "b2c"; documentType: string; day: string }): {
  status: EInvoiceStatus; reason: string;
};
export type InvoiceSeries = {
  id: string; registrationId: string; registrationName: string; gstin: string | null; kind: InvoiceSeriesKind; financialYear: string; prefix: string; padding: number;
  nextNumber: number; issued: number; status: "active" | "closed"; nextFormatted: string; version: number;
};
export type InvoiceRegistration = {
  id: string; name: string; gstin: string | null; stateCode: string | null; registrationType: string; status: string; einvoiceApplicable: boolean; einvoiceApplicableFrom: string | null;
};
export declare function listInvoiceSeries(client: any, context: InvoicingContext, input?: { registrationId?: string | null }): Promise<{
  currentFinancialYear: string; defaultPrefixes: Record<InvoiceSeriesKind, string>; einvoiceProviderAvailable: boolean; registrations: InvoiceRegistration[]; series: InvoiceSeries[];
}>;
export declare function saveInvoiceSeries(client: any, context: InvoicingContext, input: {
  registrationId: string; kind: InvoiceSeriesKind; financialYear?: string; prefix?: string; padding?: number; status?: "active" | "closed";
}): Promise<{ id: string; kind: InvoiceSeriesKind; financialYear: string; prefix: string; padding: number; nextFormatted: string; status: string }>;
export declare function setEInvoiceApplicability(client: any, context: InvoicingContext, registrationId: string, input: { applicable: boolean; applicableFrom?: string | null }): Promise<{
  registrationId: string; name: string; gstin: string | null; applicable: boolean; applicableFrom: string | null; providerAvailable: boolean;
}>;
