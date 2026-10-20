type Q = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type C = { organizationId: string; userId?: string | null; permissions?: readonly string[]; roleSlugs?: readonly string[] };
type R = Record<string, any>;
export declare function requestAttendanceCorrection(client: Q, c: C, input?: R): Promise<R>;
export declare function decideAttendanceCorrection(client: Q, c: C, id: string, input?: { approve?: boolean; note?: string }): Promise<R>;
export declare function cancelAttendanceCorrection(client: Q, c: C, id: string): Promise<R>;
export declare function listAttendanceCorrections(client: Q, c: C, filters?: R): Promise<R[]>;
