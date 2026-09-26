type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
export declare function salesOrderCompanyId(client: Queryable, organizationId: string, orderId: string): Promise<string>;
export declare function salesFulfillmentRequestCompanyId(client: Queryable, organizationId: string, requestId: string): Promise<string>;
export declare function salesReturnRequestCompanyId(client: Queryable, organizationId: string, returnId: string): Promise<string>;
export declare function salesOrderAmendmentLineage(
  client: Queryable,
  organizationId: string,
  orderId: string,
  orderVersionId: string,
): Promise<{ previousVersionId: string; resumeStatus: "confirmed" | "on_hold" } | null>;
