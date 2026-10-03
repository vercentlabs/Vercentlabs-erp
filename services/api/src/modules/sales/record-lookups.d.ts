type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
export declare function salesOrderAmendmentLineage(
  client: Queryable,
  organizationId: string,
  orderId: string,
  orderVersionId: string,
): Promise<{ previousVersionId: string; resumeStatus: "confirmed" | "on_hold" } | null>;
