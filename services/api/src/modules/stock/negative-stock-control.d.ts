type Client = any;
export declare const NEGATIVE_STOCK_POLICIES: ReadonlyArray<{ id: "block" | "allow_with_override"; label: string }>;
export declare const NEGATIVE_OVERRIDE_REASONS: ReadonlyArray<{ id: string; label: string }>;
export declare const NEGATIVE_STOCK_CODES: ReadonlyArray<string>;
export declare function isNegativeStockCode(code: unknown): boolean;
export declare function recordBlockedNegativeStockAttempt(client: Client, organizationId: string, userId: string | null | undefined, error: unknown): Promise<boolean>;
