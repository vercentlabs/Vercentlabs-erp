export type RecordScopeLevel = "own" | "team" | "company";
export declare const RECORD_SCOPE_LEVELS: ReadonlyArray<{ key: RecordScopeLevel; label: string; description: string }>;
export declare const RECORD_SCOPES: Readonly<Record<string, { label: string; records: string; own: readonly string[]; team: readonly string[]; company: readonly string[] }>>;
export declare function recordScopeKeys(app: string, level: RecordScopeLevel): string[];
export declare function recordScopeLevel(app: string, permissionKeys: readonly string[]): RecordScopeLevel | null;
export declare function withRecordScope(permissionKeys: readonly string[], app: string, level: RecordScopeLevel): string[];
export declare function appsInPermissions(permissionKeys: readonly string[]): string[];
