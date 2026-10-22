// RFQs, the comparison and the award (Procurement plan Phase 2).
type Row = Record<string, any>;
export declare const RFQ_STATUS_LABELS: Readonly<Record<string, string>>;
export declare const RFQ_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export declare function listPurchaseRfqs(client: any, context: any, filters?: Row): Promise<Row[] | { rows: Row[]; total: number; limit: number; offset: number }>;
export declare function getPurchaseRfq(client: any, context: any, rfqId: string): Promise<Row>;
export declare function createPurchaseRfq(client: any, context: any, input?: Row): Promise<{ id: string; number: string }>;
export declare function updatePurchaseRfq(client: any, context: any, rfqId: string, input?: Row): Promise<{ id: string }>;
export declare function sendPurchaseRfq(client: any, context: any, rfqId: string, input?: Row): Promise<Row>;
export declare function recordRfqQuotation(client: any, context: any, rfqId: string, input?: Row): Promise<Row>;
export declare function declineRfqSupplier(client: any, context: any, rfqId: string, input?: Row): Promise<{ id: string }>;
export declare function getRfqComparison(client: any, context: any, rfqId: string): Promise<Row>;
export declare function awardPurchaseRfq(client: any, context: any, rfqId: string, input?: Row): Promise<Row>;
export declare function cancelPurchaseRfq(client: any, context: any, rfqId: string): Promise<{ id: string; status: string }>;
export declare function closePurchaseRfq(client: any, context: any, rfqId: string): Promise<{ id: string; status: string }>;
