type Env = Record<string, string | undefined>;
export class SecretEncryptionError extends Error {
  readonly status: number;
  readonly code: string;
}
export type SecretEnvelope = { v: 1; alg: "A256GCM"; kek: string; dek: string; iv: string; tag: string; ciphertext: string };
export type KeyProvider = {
  name: string;
  wrap(dek: Buffer): Promise<{ kek: string; wrapped: Buffer }>;
  unwrap(wrapped: Buffer, kek: string): Promise<Buffer>;
  currentKeyReference(): Promise<string>;
};
export function createLocalKeyProvider(env?: Env): KeyProvider;
export function createGcpKmsKeyProvider(env?: Env, options?: { client?: unknown }): KeyProvider;
export function setSecretsProviderForTests(provider: KeyProvider | null): void;
export function resolveSecretsProvider(env?: Env): KeyProvider;
export function isEnvelope(payload: unknown): boolean;
export function isLegacyPayload(payload: unknown): boolean;
export function encryptSecret(value: unknown, env?: Env): Promise<SecretEnvelope>;
export function decryptSecret<T = any>(payload: unknown, env?: Env): Promise<T>;
export function secretKeyReference(payload: unknown): string;
export const ENCRYPTED_COLUMNS: ReadonlyArray<{ table: string; column: string; purpose: string }>;
export function secretInventory(queryable: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> }): Promise<Array<{ table: string; column: string; keyReference: string; count: number }>>;
export function reencryptSecrets(
  withTransaction: <T>(work: (client: any) => Promise<T>) => Promise<T>,
  options?: { mode?: "legacy" | "rotate"; dryRun?: boolean; batchSize?: number; maxBatches?: number; env?: Env },
): Promise<{ mode: string; dryRun: boolean; currentKey: string; columns: Array<{ table: string; column: string; rewritten: number; wouldRewrite: number; failed: number }> }>;
