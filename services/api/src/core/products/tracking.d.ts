type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type AppContext = { organizationId: string; apps?: string[] };

export declare function stockOn(client: Queryable, context: AppContext): Promise<boolean>;
export declare function productTracksStock(item: Record<string, unknown> | null | undefined): boolean;
export declare function tracksStock(client: Queryable, context: AppContext, item: Record<string, unknown> | null | undefined): Promise<boolean>;
export declare function defaultProductType(client: Queryable, context: AppContext): Promise<"stock" | "non_stock">;
