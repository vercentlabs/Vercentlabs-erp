type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
export declare function accountingDocumentContentHash(client: Queryable, organizationId: string, documentType: "journal" | "invoice" | "bill" | "payment", id: string): Promise<string>;
export declare function primaryAccountingLedgerId(client: Queryable, organizationId: string, companyId: string): Promise<string | null>;
