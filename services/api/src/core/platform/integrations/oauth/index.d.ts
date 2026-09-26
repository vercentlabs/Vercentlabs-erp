type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };
type Env = Record<string, string | undefined>;

export type OAuthProfile = Readonly<{ key: string; provider: "google" | "microsoft"; label: string; description: string; scopes: readonly string[] }>;
export const OAUTH_PROFILES: readonly OAuthProfile[];
export const OAUTH_RETURN_PREFIXES: readonly string[];
export function getOAuthProfile(key: string): OAuthProfile | null;

export class OAuthError extends Error {
  status: number;
  code: string;
}
export function oauthCallbackUri(provider: string, env?: Env): string;
export function safeReturnPath(value: unknown): string;
export function oauthProfilesStatus(env?: Env): Array<{ key: string; provider: string; label: string; description: string; scopes: string[]; configured: boolean }>;
export function beginOAuthConnection(client: Client, session: Session, input: { profile: string; returnPath?: string }, env?: Env): Promise<{ authorizeUrl: string; expiresInSeconds: number }>;
export function consumeOAuthState(client: Client, session: Session, provider: string, state: string, env?: Env): Promise<{ profileKey: string; redirectUri: string; returnPath: string; codeVerifier: string }>;
export type ExchangedOAuthConnection = {
  profileKey: string;
  provider: string;
  accountId: string | null;
  accountLabel: string | null;
  grantedScopes: string[];
  tokens: { accessToken: string; refreshToken: string | null; tokenType: string; receivedAt: string };
  expiresAt: Date | null;
};
export function exchangeOAuthCode(profileKey: string, input: { code: string; redirectUri: string; codeVerifier: string }, env?: Env): Promise<ExchangedOAuthConnection>;
export function saveOAuthConnection(client: Client, session: Session, exchanged: ExchangedOAuthConnection, env?: Env): Promise<{ id: string }>;
export type OAuthConnectionSummary = {
  id: string;
  provider: string;
  profileKey: string;
  profileLabel: string;
  accountLabel: string | null;
  connectedByUserId: string;
  connectedByName: string | null;
  scopes: string[];
  status: "active" | "expired" | "revoked" | "error" | "reconnect_required";
  expiresAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};
export function listOAuthConnections(client: Client, organizationId: string, options?: { userId?: string | null }): Promise<OAuthConnectionSummary[]>;
export function revokeOAuthConnection(client: Client, session: Session, id: string, options?: { administrator?: boolean }): Promise<{ id: string; status: "revoked" }>;
export function getOAuthAccessToken(withClient: <T>(work: (client: Client) => Promise<T>) => Promise<T>, input: { organizationId: string; connectionId: string }, env?: Env): Promise<string>;
