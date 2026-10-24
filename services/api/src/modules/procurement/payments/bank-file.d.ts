// The bank payment file (Procurement report Phase 2).
export declare const BANK_FILE_LAYOUTS: ReadonlyArray<{ code: string; label: string }>;
export declare function bankFileFor(client: any, context: any, input: { paymentIds: string[] }): Promise<{ fileName: string; content: string; included: number; problems: string[] }>;
