type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type AppContext = { organizationId: string; roleSlugs?: string[]; permissions?: string[]; apps?: string[] };

export declare function loadApps(client: Queryable, context: AppContext): Promise<Set<string>>;
export declare function appsFromSnapshot(snapshot: { modules?: ReadonlyArray<{ moduleId: string; released: boolean; enabled: boolean; reason?: string }> } | null | undefined): string[] | undefined;
export declare function hasApp(context: AppContext, app: string): boolean;
export declare function canInApp(context: AppContext, app: string, permission: string): boolean;
export declare function mayInApp(client: Queryable, context: AppContext, app: string, permission: string): Promise<boolean>;
export declare function appOn(client: Queryable, context: AppContext, app: string): Promise<boolean>;
