export declare class ApiKeyError extends Error {
  status: number;
  code?: string;
}
export declare function createTenantApiKeyMaterial(): { token: string; prefix: string; hash: string };
export declare function apiKeyHash(token: string): string;
export declare function createDeveloperApiKey(client: any, session: any, input: any): Promise<any>;
export declare function listDeveloperApiKeys(client: any, organizationId: string): Promise<any[]>;
export declare function revokeDeveloperApiKey(client: any, session: any, id: string): Promise<void>;
export declare function authenticateTenantApiKey(client: any, token: string): Promise<any>;
export declare function requireTenantApiScope(client: any, request: Request, requiredScope: string): Promise<any>;
