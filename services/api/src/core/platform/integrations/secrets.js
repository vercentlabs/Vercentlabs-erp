// AES-256-GCM envelope for integration secrets at rest (OAuth tokens and PKCE
// verifiers, webhook signing secrets, MFA TOTP seeds). The key is
// INTEGRATION_TOKEN_ENCRYPTION_KEY: exactly 32 bytes, hex or base64, required.
// Key rotation/re-encryption is Prompt 6's secrets work.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class IntegrationSecretError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "IntegrationSecretError";
    this.status = status;
    this.code = code;
  }
}

function encryptionKey(env) {
  const raw = String(env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new IntegrationSecretError(503, "Integration token encryption is not configured.", "PLATFORM_TOKEN_ENCRYPTION_NOT_CONFIGURED");
  const candidate = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (candidate.length !== 32) throw new IntegrationSecretError(503, "Integration token encryption key must be exactly 32 bytes.", "PLATFORM_TOKEN_ENCRYPTION_NOT_CONFIGURED");
  return candidate;
}

export function encryptIntegrationCredentials(value, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { algorithm: "A256GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") };
}

export function decryptIntegrationCredentials(payload, env = process.env) {
  if (payload?.algorithm !== "A256GCM" || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new IntegrationSecretError(500, "Stored integration credentials are invalid.", "PLATFORM_CREDENTIALS_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
