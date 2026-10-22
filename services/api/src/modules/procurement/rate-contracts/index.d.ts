// Rate contracts (Procurement plan Phase 3).
type Row = Record<string, any>;
export declare const PURCHASE_RATE_CONTRACT_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export declare const PURCHASE_RATE_CONTRACT_STATUS_LABELS: Readonly<Record<string, string>>;
export declare function listPurchaseRateContracts(client: any, context: any, filters?: Row): Promise<Row[] | { rows: Row[]; total: number; limit: number; offset: number }>;
export declare function getPurchaseRateContract(client: any, context: any, contractId: string): Promise<Row>;
export declare function createPurchaseRateContract(client: any, context: any, input?: Row): Promise<{ id: string; number: string }>;
export declare function updatePurchaseRateContract(client: any, context: any, contractId: string, input?: Row): Promise<{ id: string }>;
export declare function activatePurchaseRateContract(client: any, context: any, contractId: string): Promise<{ id: string; status: string }>;
export declare function cancelPurchaseRateContract(client: any, context: any, contractId: string): Promise<{ id: string; status: string }>;
export declare function contractRatesFor(client: any, organizationId: string, input: Row): Promise<Map<string, Row>>;
export declare function activeContractsByItem(client: any, organizationId: string, itemIds: string[], date: string): Promise<Map<string, Row>>;
export declare function contractOverdraw(contract: Row, quantity: unknown, value: unknown): string[];
