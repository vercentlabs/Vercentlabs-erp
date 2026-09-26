type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };
type Env = Record<string, string | undefined>;

export type ApiScopeDefinition = Readonly<{ key: string; displayName: string; description: string; risk: "low" | "medium" | "high"; consumedBy: readonly string[] }>;
export const API_SCOPES: readonly ApiScopeDefinition[];
export const API_VERSION: string;
export function getApiScope(key: string): ApiScopeDefinition | null;
export function listApiScopes(): Array<{ key: string; displayName: string; description: string; risk: string }>;

export class ApiKeyError extends Error {
  status: number;
  code: string;
}
export type ApiPrincipal = Readonly<{ kind: "api_key"; organizationId: string; developerAppId: string; developerAppName: string; apiKeyId: string; scopes: readonly string[] }>;
export type DeveloperApp = { id: string; name: string; description: string; status: "active" | "revoked"; createdAt: string; createdByName: string | null; revokedAt: string | null; activeKeyCount: number; lastUsedAt: string | null };
export type ApiKeySummary = {
  id: string;
  developerAppId: string;
  name: string;
  prefix: string;
  scopes: string[];
  unrecognizedScopes: string[];
  status: "active" | "revoked" | "expired";
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
};
export function createTenantApiKeyMaterial(): Readonly<{ token: string; prefix: string; hash: string }>;
export function apiKeyHash(token: string): string;
export function normalizeApiScopes(value: unknown): string[];
export function listDeveloperApps(client: Client, organizationId: string): Promise<DeveloperApp[]>;
export function createDeveloperApp(client: Client, session: Session, input: { name: string; description?: string }): Promise<DeveloperApp>;
export function updateDeveloperApp(client: Client, session: Session, appId: string, input: { name?: string; description?: string }): Promise<DeveloperApp>;
export function revokeDeveloperApp(client: Client, session: Session, appId: string): Promise<{ id: string; status: "revoked"; revokedKeys: number }>;
export function listApiKeys(client: Client, organizationId: string, appId?: string | null): Promise<ApiKeySummary[]>;
export function createApiKey(client: Client, session: Session, appId: string, input: { name: string; scopes: string[]; expiresAt?: string | null }): Promise<{ key: ApiKeySummary; token: string }>;
export function revokeApiKey(client: Client, session: Session, keyId: string): Promise<ApiKeySummary>;
export function authenticateApiKey(client: Client, token: string): Promise<ApiPrincipal>;
export function requireApiScope(principal: ApiPrincipal, scope: string): ApiPrincipal;
export function getApiPlatformContext(
  client: Client,
  principal: ApiPrincipal,
  env?: Env,
): Promise<{
  apiVersion: string;
  organization: { id: string; name: string; slug: string; countryCode: string; timezone: string; baseCurrency: string };
  app: { id: string; name: string };
  apiKey: { id: string; scopes: string[] };
  modules: string[];
}>;
