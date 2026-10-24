// The supplier's own page (Procurement report H5).
type Row = Record<string, any>;
export declare function supplierLinkToken(client: any, context: any, documentType: "purchase_order" | "rfq_supplier", documentId: string, env?: Record<string, string | undefined>): Promise<string>;
export declare function supplierPageUrl(token: string, env?: Record<string, string | undefined>): string;
export declare function shareRfqSupplierLink(client: any, context: any, rfqId: string, supplierId: string, env?: Record<string, string | undefined>): Promise<{ url: string; body: string; whatsapp: string }>;
export declare function loadSupplierPage(client: any, token: string): Promise<Row | null>;
export declare function answerOrderOnSupplierPage(client: any, token: string, input?: Row): Promise<Row>;
export declare function quoteOnSupplierPage(client: any, token: string, input?: Row): Promise<{ quotationId: string | null }>;
export declare function uploadInvoiceOnSupplierPage(client: any, token: string, input: Row, prepared: unknown): Promise<{ status: string; draftBill: boolean }>;
export declare function supplierPageActivity(client: any, context: any, orderId: string): Promise<Row>;
