export type PlatformOAuthProvider = "google" | "microsoft";
export declare class OAuthError extends Error {
  status: number;
  code?: string;
}
export declare function encryptIntegrationCredentials(value: Record<string, unknown>, env?: any): { algorithm: string; iv: string; tag: string; ciphertext: string };
export declare function decryptIntegrationCredentials(payload: unknown, env?: any): Record<string, unknown>;
export declare function beginOAuthConnection(client: any, session: any, provider: PlatformOAuthProvider, input: any, env?: any): Promise<{ state: string; authorizeUrl: string; expiresInSeconds: number }>;
export declare function completeOAuthConnection(client: any, session: any, provider: PlatformOAuthProvider, input: any, env?: any): Promise<{ id: string; expiresAt: Date | null }>;
export declare function listOAuthConnections(client: any, organizationId: string): Promise<any[]>;
export declare function revokeOAuthConnection(client: any, session: any, id: string): Promise<void>;
