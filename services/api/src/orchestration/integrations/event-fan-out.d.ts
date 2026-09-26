export const EVENT_FAN_OUT: ReadonlyArray<(client: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> }, event: Record<string, any>) => Promise<void>>;
