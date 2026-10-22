// Purchase indents (Procurement plan Phase 2).
type Row = Record<string, any>;
export declare const INDENT_PERMISSIONS: Readonly<Record<"create" | "manage" | "approve", string>>;
export declare const INDENT_STATUS_LABELS: Readonly<Record<string, string>>;
export declare const INDENT_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export declare function requireIndentAccess(context: any): void;
export declare function listPurchaseIndents(client: any, context: any, filters?: Row): Promise<Row[] | { rows: Row[]; total: number; limit: number; offset: number }>;
export declare function getPurchaseIndent(client: any, context: any, indentId: string): Promise<Row>;
export declare function createPurchaseIndent(client: any, context: any, input?: Row, options?: { source?: string }): Promise<{ id: string; number: string; status: string }>;
export declare function updatePurchaseIndent(client: any, context: any, indentId: string, input?: Row): Promise<{ id: string; status: string }>;
export declare function submitPurchaseIndent(client: any, context: any, indentId: string): Promise<{ id: string; status: string }>;
export declare function approvePurchaseIndent(client: any, context: any, indentId: string, input?: Row): Promise<{ id: string; status: string }>;
export declare function rejectPurchaseIndent(client: any, context: any, indentId: string, input?: Row): Promise<{ id: string; status: string }>;
export declare function closePurchaseIndent(client: any, context: any, indentId: string): Promise<{ id: string; status: string }>;
export declare function cancelPurchaseIndent(client: any, context: any, indentId: string): Promise<{ id: string; status: string }>;
export declare function listIndentLinesToOrder(client: any, context: any, filters?: Row): Promise<Row[]>;
export declare function createPurchaseOrderFromIndents(client: any, context: any, input?: Row): Promise<Row>;
export declare function draftIndentFromReorder(client: any, context: any, input: Row): Promise<{ id: string; number: string; status: string }>;
