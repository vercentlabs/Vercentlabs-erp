type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Env = Record<string, string | undefined>;
export type SignInProvider = "google" | "microsoft";
export type SocialSignInState = { provider: SignInProvider; purpose: "sign_in" | "link"; userId: string | null; verifier: string; nonceHash: string; returnTo: string | null };
export type SocialIdentity = { provider: SignInProvider; subject: string; email: string | null; emailVerified: boolean };
export const SIGN_IN_PROVIDERS: readonly SignInProvider[];
export class SocialSignInError extends Error { status: number; code: string }
export function socialSignInCallbackUri(provider: string, env?: Env): string;
export function socialSignInProviders(env?: Env): SignInProvider[];
export function beginSocialSignIn(client: Client, input: { provider: string; purpose?: "sign_in" | "link"; userId?: string | null; returnTo?: string | null }, env?: Env): Promise<{ url: string }>;
export function consumeSocialSignInState(client: Client, provider: string, state: string | null, env?: Env): Promise<SocialSignInState>;
export function exchangeSocialSignInCode(state: SocialSignInState, code: string | null, env?: Env): Promise<SocialIdentity>;
export function resolveSocialSignIn(client: Client, state: SocialSignInState, identity: SocialIdentity): Promise<string>;
export function listSocialIdentities(client: Client, userId: string): Promise<Array<{ id: string; provider: SignInProvider; email: string | null; linkedAt: string; lastUsedAt: string | null }>>;
export function unlinkSocialIdentity(client: Client, userId: string, identityId: string): Promise<{ unlinked: true }>;
