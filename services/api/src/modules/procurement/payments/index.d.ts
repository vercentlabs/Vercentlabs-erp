// Supplier Payments, the advances a supplier holds and MSME payments (Procurement plan Phase 1).
export declare const SUPPLIER_PAYMENT_METHODS: Readonly<Record<string, string>>;
export declare const SUPPLIER_PAYMENT_STATUS_LABELS: Readonly<Record<string, string>>;
export declare const SUPPLIER_PAYMENT_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export declare const MSME_PAYMENT_BUCKETS: ReadonlyArray<{ key: string; label: string }>;
export declare function listSupplierPayments(client: any, context: any, filters?: Record<string, unknown>): Promise<{ rows: Array<Record<string, any>>; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; methods: Array<{ code: string; label: string }> }>;
export declare function getSupplierPayment(client: any, context: any, paymentId: string): Promise<Record<string, any>>;
export declare function paySupplierBills(client: any, context: any, input?: Record<string, unknown>): Promise<{ payments: Array<Record<string, any>> }>;
export declare function completeSupplierPayment(client: any, context: any, paymentId: string): Promise<{ paymentId: string; status: string; skipped?: string[] }>;
export declare function getSupplierAdvances(client: any, context: any, filters?: Record<string, unknown>): Promise<{ total: string; advances: Array<Record<string, any>> }>;
export declare function listMsmePayments(client: any, context: any, filters?: Record<string, unknown>): Promise<Record<string, any>>;
