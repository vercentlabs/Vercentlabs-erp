type C = Record<string, unknown>;
type Q = unknown;
type R = Record<string, any>;
export declare function getSupportDeskDashboard(client: Q, c: C): Promise<any>;
export declare function listSupportOptions(client: Q, c: C): Promise<Record<string, Array<{ id: string; code: string; name: string }>>>;
export declare function listCustomerContacts(client: Q, c: C, partyId: string): Promise<any[]>;
