// The supplier's e-invoice QR (Procurement report Phase 2).
export type EInvoiceQr = {
  supplierGstin: string | null; buyerGstin: string | null; invoiceNumber: string | null; documentType: string | null; invoiceDate: string | null; total: string | null;
  itemCount: number | null; mainHsnCode: string | null; irn: string; irnDate: string | null; signatureVerified: boolean | null;
};
export declare function readEInvoiceQr(raw: string, env?: Record<string, string | undefined>): EInvoiceQr;
export declare function checkEInvoiceQr(client: any, context: any, input: { qr: string }): Promise<{ qr: EInvoiceQr; supplier: { id: string; name: string; status: string } | null; problems: string[] }>;
export declare function readIrn(value: unknown): string | null;
