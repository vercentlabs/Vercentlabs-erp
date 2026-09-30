type C = Record<string, unknown>;
type Q = unknown;
type R = Record<string, any>;
export declare function getQualityKpiDashboard(client: Q, c: C): Promise<any>;
export declare function listQualityOptions(client: Q, c: C): Promise<Record<string, Array<{ id: string; code: string; name: string }>>>;
