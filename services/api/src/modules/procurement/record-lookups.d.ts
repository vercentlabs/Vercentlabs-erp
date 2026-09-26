type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
export declare function procurementRecordCompanyId(client: Queryable, organizationId: string, resource: "receipts" | "returns" | "purchase-orders", id: string): Promise<string | null>;
