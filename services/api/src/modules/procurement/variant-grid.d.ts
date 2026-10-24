// The variant grid on purchase orders (report Phase 3).
type Row = Record<string, any>;
export declare function searchPurchaseVariantTemplates(client: any, context: any, input?: { search?: string }): Promise<{ templates: Row[] }>;
export declare function getPurchaseVariantGrid(client: any, context: any, templateId: string): Promise<Row>;
