// Envelope encryption for secrets at rest (MFA TOTP seeds, OAuth tokens and
// PKCE verifiers, webhook and inbound-mail signing secrets).
//
//   value --AES-256-GCM (random 32-byte DEK, random IV)--> ciphertext
//   DEK   --key-encryption key (Cloud KMS in production)--> wrapped DEK
//
// Stored envelope (jsonb):
//   { v: 1, alg: "A256GCM", kek: "<provider key-version reference>",
//     dek: <wrapped DEK, base64>, iv, tag, ciphertext }
//
// The plaintext DEK is never stored. `kek` records the exact key version that
// wrapped the DEK, so rotating the Cloud KMS primary version never makes old
// data unreadable (KMS decrypts with whichever version encrypted it) and
// `pnpm secrets:reencrypt` can find envelopes still on an older version.
//
// Providers (SECRETS_ENCRYPTION_PROVIDER):
//   gcp-kms  production. SECRETS_KMS_KEY_NAME; Workload Identity credentials.
//   local    development and tests. SECRETS_LOCAL_MASTER_KEY (32 bytes) or a
//            fixed development key; refused in production.
//
// Legacy rows ({ algorithm: "A256GCM", iv, tag, ciphertext }) were encrypted
// directly with INTEGRATION_TOKEN_ENCRYPTION_KEY. They stay readable while that
// key is configured; new writes always use envelopes, and
// `pnpm secrets:migrate-legacy` rewrites the old rows.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class SecretEncryptionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "SecretEncryptionError";
    this.status = status;
    this.code = code;
  }
}

const notConfigured = (message) => new SecretEncryptionError(503, message, "PLATFORM_SECRETS_NOT_CONFIGURED");
const invalidPayload = () => new SecretEncryptionError(500, "Stored secret is invalid.", "PLATFORM_CREDENTIALS_INVALID");

function key32(raw, name) {
  const value = String(raw || "").trim();
  const bytes = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw notConfigured(`${name} must be exactly 32 bytes.`);
  return bytes;
}

function gcmEncrypt(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function gcmDecrypt(key, { iv, tag, ciphertext }) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ------------------------------------------------------------------ providers

// Development/test key-encryption key. A fixed fallback keeps local data
// readable across restarts; it is never accepted in production.
const DEVELOPMENT_MASTER_KEY = createHash("sha256").update("vercentlabs-local-development-secrets-v1").digest();

export function createLocalKeyProvider(env = process.env) {
  if (env.NODE_ENV === "production") throw notConfigured("The local secrets provider cannot be used in production.");
  const master = env.SECRETS_LOCAL_MASTER_KEY ? key32(env.SECRETS_LOCAL_MASTER_KEY, "SECRETS_LOCAL_MASTER_KEY") : DEVELOPMENT_MASTER_KEY;
  const reference = `local:${createHash("sha256").update(master).digest("hex").slice(0, 16)}`;
  return {
    name: "local",
    async wrap(dek) {
      const { iv, tag, ciphertext } = gcmEncrypt(master, dek);
      return { kek: reference, wrapped: Buffer.concat([iv, tag, ciphertext]) };
    },
    async unwrap(wrapped, kek) {
      if (kek !== reference) throw new SecretEncryptionError(500, "The local secrets key does not match this envelope.", "PLATFORM_SECRETS_KEY_MISMATCH");
      return gcmDecrypt(master, { iv: wrapped.subarray(0, 12), tag: wrapped.subarray(12, 28), ciphertext: wrapped.subarray(28) });
    },
    async currentKeyReference() {
      return reference;
    },
  };
}

export function createGcpKmsKeyProvider(env = process.env, { client } = {}) {
  const keyName = String(env.SECRETS_KMS_KEY_NAME || "").trim();
  if (!keyName) throw notConfigured("SECRETS_KMS_KEY_NAME is required for the gcp-kms secrets provider.");
  let kms = client ?? null;
  const connect = async () => {
    if (!kms) {
      const { KeyManagementServiceClient } = await import("@google-cloud/kms");
      kms = new KeyManagementServiceClient();
    }
    return kms;
  };
  return {
    name: "gcp-kms",
    async wrap(dek) {
      const [response] = await (await connect()).encrypt({ name: keyName, plaintext: dek });
      // response.name is the exact crypto key VERSION used.
      return { kek: response.name, wrapped: Buffer.from(response.ciphertext) };
    },
    async unwrap(wrapped, kek) {
      if (!String(kek).startsWith(`${keyName}/cryptoKeyVersions/`)) throw new SecretEncryptionError(500, "This secret was wrapped by a different Cloud KMS key.", "PLATFORM_SECRETS_KEY_MISMATCH");
      // Symmetric decrypt takes the key (not the version): KMS finds the
      // version from the ciphertext, so older versions keep working.
      const [response] = await (await connect()).decrypt({ name: keyName, ciphertext: wrapped });
      return Buffer.from(response.plaintext);
    },
    async currentKeyReference() {
      return (await this.wrap(randomBytes(32))).kek;
    },
  };
}

let providerOverride = null;
let cachedProvider = null;
let cachedProviderKey = null;

/** Tests inject a provider (e.g. a fake KMS) for the process; null restores. */
export function setSecretsProviderForTests(provider) {
  providerOverride = provider;
  dekCache.clear();
}

export function resolveSecretsProvider(env = process.env) {
  if (providerOverride) return providerOverride;
  const production = env.NODE_ENV === "production";
  const kind = String(env.SECRETS_ENCRYPTION_PROVIDER || (production ? "" : "local")).trim().toLowerCase();
  const cacheKey = `${kind}|${env.SECRETS_KMS_KEY_NAME || ""}|${env.SECRETS_LOCAL_MASTER_KEY ? createHash("sha256").update(String(env.SECRETS_LOCAL_MASTER_KEY)).digest("hex") : ""}|${env.NODE_ENV || ""}`;
  if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
  if (kind === "gcp-kms") cachedProvider = createGcpKmsKeyProvider(env);
  else if (kind === "local") cachedProvider = createLocalKeyProvider(env);
  else throw notConfigured("SECRETS_ENCRYPTION_PROVIDER must be gcp-kms (production) or local.");
  cachedProviderKey = cacheKey;
  return cachedProvider;
}

// Unwrapped DEKs are cached briefly so hot paths (webhook signing, MFA
// checks) do not call KMS on every use. Bounded in size and time.
const DEK_CACHE_LIMIT = 512;
const DEK_CACHE_TTL_MS = 5 * 60_000;
const dekCache = new Map();

async function unwrapCached(provider, wrapped, kek) {
  const id = createHash("sha256").update(kek).update(wrapped).digest("hex");
  const hit = dekCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.dek;
  const dek = await provider.unwrap(wrapped, kek);
  if (dekCache.size >= DEK_CACHE_LIMIT) dekCache.delete(dekCache.keys().next().value);
  dekCache.set(id, { dek, expires: Date.now() + DEK_CACHE_TTL_MS });
  return dek;
}

// ------------------------------------------------------------------- envelope

export function isEnvelope(payload) {
  return payload?.v === 1 && payload.alg === "A256GCM" && Boolean(payload.kek && payload.dek && payload.iv && payload.tag && payload.ciphertext);
}

export function isLegacyPayload(payload) {
  return payload?.algorithm === "A256GCM" && payload.v === undefined && Boolean(payload.iv && payload.tag && payload.ciphertext);
}

/** Encrypts any JSON-serialisable value into a new envelope (always the current key). */
export async function encryptSecret(value, env = process.env) {
  const provider = resolveSecretsProvider(env);
  const dek = randomBytes(32);
  try {
    const { iv, tag, ciphertext } = gcmEncrypt(dek, Buffer.from(JSON.stringify(value), "utf8"));
    const { kek, wrapped } = await provider.wrap(dek);
    return { v: 1, alg: "A256GCM", kek, dek: wrapped.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") };
  } finally {
    dek.fill(0);
  }
}

/** Decrypts an envelope, or a legacy A256GCM payload while the legacy key is configured. */
export async function decryptSecret(payload, env = process.env) {
  if (isEnvelope(payload)) {
    const dek = await unwrapCached(resolveSecretsProvider(env), Buffer.from(payload.dek, "base64"), payload.kek);
    try {
      return JSON.parse(gcmDecrypt(dek, { iv: Buffer.from(payload.iv, "base64"), tag: Buffer.from(payload.tag, "base64"), ciphertext: Buffer.from(payload.ciphertext, "base64") }).toString("utf8"));
    } catch {
      throw invalidPayload();
    }
  }
  if (isLegacyPayload(payload)) {
    if (!String(env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "").trim()) {
      throw notConfigured("A legacy secret needs INTEGRATION_TOKEN_ENCRYPTION_KEY until pnpm secrets:migrate-legacy has rewritten it.");
    }
    const key = key32(env.INTEGRATION_TOKEN_ENCRYPTION_KEY, "INTEGRATION_TOKEN_ENCRYPTION_KEY");
    try {
      return JSON.parse(gcmDecrypt(key, { iv: Buffer.from(payload.iv, "base64"), tag: Buffer.from(payload.tag, "base64"), ciphertext: Buffer.from(payload.ciphertext, "base64") }).toString("utf8"));
    } catch {
      throw invalidPayload();
    }
  }
  throw invalidPayload();
}

/** Where a stored payload stands: "legacy", or the key reference that wrapped it. */
export function secretKeyReference(payload) {
  if (isEnvelope(payload)) return payload.kek;
  if (isLegacyPayload(payload)) return "legacy";
  return "invalid";
}
