// The document chain of a Procurement document (Procurement plan Phase 1).
export interface ProcurementChainDocument { id: string; number: string; status: string; statusLabel: string; href: string | null }
export interface ProcurementChainStep { key: string; label: string; reached: boolean; documents: ProcurementChainDocument[] }
export declare const PROCUREMENT_CHAIN_TYPES: readonly string[];
export declare function getProcurementDocumentChain(client: any, context: any, type: string, id: string): Promise<{ current: { type: string; id: string }; direct: boolean; steps: ProcurementChainStep[] }>;
