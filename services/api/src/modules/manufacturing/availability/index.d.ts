// Manufacturing Material Availability (0114).
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Ctx = { organizationId: string; userId: string; permissions: string[]; roleSlugs: string[] };
type Rec = Record<string, unknown>;
export declare const MATERIAL_PERMISSIONS: Readonly<Record<string, string>>;
export declare function getMaterialAvailability(client: Client, c: Ctx, id: string, input?: Rec): Promise<any>;
export declare function previewMaterialReservation(client: Client, c: Ctx, id: string): Promise<any>;
export declare function validateMaterialIssueReadiness(client: Client, c: Ctx, id: string, input: Rec): Promise<any>;
export declare function requestMaterialShortages(client: Client, c: Ctx, id: string, input?: Rec): Promise<any>;
export declare function listMaterialShortages(client: Client, c: Ctx, filters?: Rec): Promise<any[]>;
export declare function getMaterialReport(client: Client, c: Ctx, kind?: string): Promise<any[]>;
export declare function previewBomAvailability(client: Client, c: Ctx, revisionId: string, input: Rec): Promise<any>;
