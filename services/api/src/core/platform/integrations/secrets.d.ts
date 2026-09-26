export class IntegrationSecretError extends Error {
  status: number;
  code: string;
}
export type EncryptedEnvelope = { algorithm: "A256GCM"; iv: string; tag: string; ciphertext: string };
export function encryptIntegrationCredentials(value: unknown, env?: Record<string, string | undefined>): EncryptedEnvelope;
export function decryptIntegrationCredentials<T = any>(payload: unknown, env?: Record<string, string | undefined>): T;
