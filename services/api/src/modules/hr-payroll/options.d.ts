type C = Record<string, unknown>;
export declare function listHrOptions(client: unknown, c: C): Promise<Record<string, Array<{ id: string; code: string; name: string }>>>;
export declare function listSelfOptions(client: unknown, c: C): Promise<Record<string, Array<{ id: string; code: string; name: string }>>>;
