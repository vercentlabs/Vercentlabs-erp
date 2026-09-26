import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";

import {
  createGcpKmsKeyProvider,
  createLocalKeyProvider,
  decryptSecret,
  encryptSecret,
  isEnvelope,
  resolveSecretsProvider,
  secretKeyReference,
  setSecretsProviderForTests,
} from "../../src/core/platform/secrets/index.js";

const KEY = "projects/vl-test-project/locations/asia-south1/keyRings/erp/cryptoKeys/secrets";

// A fake Cloud KMS: each key version has its own AES key; the ciphertext
// carries the version number (like real KMS ciphertext carries its version).
function fakeKms() {
  const versions = [randomBytes(32)];
  let primary = 1;
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    rotate() {
      versions.push(randomBytes(32));
      primary = versions.length;
    },
    destroy(version) {
      versions[version - 1] = null;
    },
    calls,
    client: {
      async encrypt({ name, plaintext }) {
        calls.encrypt += 1;
        assert.equal(name, KEY);
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", versions[primary - 1], iv);
        const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return [{ name: `${KEY}/cryptoKeyVersions/${primary}`, ciphertext: Buffer.concat([Buffer.from([primary]), iv, cipher.getAuthTag(), body]) }];
      },
      async decrypt({ name, ciphertext }) {
        calls.decrypt += 1;
        assert.equal(name, KEY);
        const key = versions[ciphertext[0] - 1];
        if (!key) throw Object.assign(new Error("key version destroyed"), { code: 9 });
        const decipher = createDecipheriv("aes-256-gcm", key, ciphertext.subarray(1, 13));
        decipher.setAuthTag(ciphertext.subarray(13, 29));
        return [{ plaintext: Buffer.concat([decipher.update(ciphertext.subarray(29)), decipher.final()]) }];
      },
    },
  };
}

test.afterEach(() => setSecretsProviderForTests(null));

test("local provider: envelope round trip; plaintext and DEK never stored; tampering fails", async () => {
  const env = { NODE_ENV: "test" };
  const sealed = await encryptSecret({ accessToken: "secret-token" }, env);
  assert.ok(isEnvelope(sealed));
  assert.match(sealed.kek, /^local:[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(sealed).includes("secret-token"));
  assert.deepEqual(await decryptSecret(sealed, env), { accessToken: "secret-token" });
  await assert.rejects(decryptSecret({ ...sealed, ciphertext: Buffer.from("tampered").toString("base64") }, env), (error) => error.code === "PLATFORM_CREDENTIALS_INVALID");
  await assert.rejects(decryptSecret({ nope: true }, env), (error) => error.code === "PLATFORM_CREDENTIALS_INVALID");
  // Two encryptions of the same value never share a DEK or ciphertext.
  const again = await encryptSecret({ accessToken: "secret-token" }, env);
  assert.notEqual(again.dek, sealed.dek);
  assert.notEqual(again.ciphertext, sealed.ciphertext);
});

test("the local provider and a missing provider are refused in production", () => {
  assert.throws(() => createLocalKeyProvider({ NODE_ENV: "production" }), (error) => error.code === "PLATFORM_SECRETS_NOT_CONFIGURED");
  assert.throws(() => resolveSecretsProvider({ NODE_ENV: "production" }), (error) => error.code === "PLATFORM_SECRETS_NOT_CONFIGURED");
  assert.throws(() => resolveSecretsProvider({ NODE_ENV: "production", SECRETS_ENCRYPTION_PROVIDER: "local" }), (error) => error.code === "PLATFORM_SECRETS_NOT_CONFIGURED");
});

test("Cloud KMS: rotating the primary version keeps old envelopes readable; new writes use the new version", async () => {
  const kms = fakeKms();
  const env = { NODE_ENV: "production", SECRETS_ENCRYPTION_PROVIDER: "gcp-kms", SECRETS_KMS_KEY_NAME: KEY };
  setSecretsProviderForTests(createGcpKmsKeyProvider(env, { client: kms.client }));
  const before = await encryptSecret({ secret: "whsec_one" }, env);
  assert.equal(before.kek, `${KEY}/cryptoKeyVersions/1`);
  kms.rotate();
  const after = await encryptSecret({ secret: "whsec_two" }, env);
  assert.equal(after.kek, `${KEY}/cryptoKeyVersions/2`);
  assert.deepEqual(await decryptSecret(before, env), { secret: "whsec_one" }, "version 1 data still decrypts after rotation");
  assert.deepEqual(await decryptSecret(after, env), { secret: "whsec_two" });
  assert.equal(secretKeyReference(before), `${KEY}/cryptoKeyVersions/1`);
  // A second decrypt of the same envelope is served from the DEK cache.
  const decrypts = kms.calls.decrypt;
  await decryptSecret(before, env);
  assert.equal(kms.calls.decrypt, decrypts);
  // An envelope wrapped by another key is refused, not sent to the wrong key.
  await assert.rejects(decryptSecret({ ...after, kek: "projects/other-project-x/locations/asia-south1/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1", dek: Buffer.from("x").toString("base64") }, env), (error) => error.code === "PLATFORM_SECRETS_KEY_MISMATCH");
});

test("legacy A256GCM payloads stay readable with the legacy key, and fail clearly without it", async () => {
  const legacyKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ secretBase32: "JBSWY3DPEHPK3PXP" }), "utf8"), cipher.final()]);
  const legacy = { algorithm: "A256GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  assert.equal(secretKeyReference(legacy), "legacy");
  assert.deepEqual(await decryptSecret(legacy, { NODE_ENV: "test", INTEGRATION_TOKEN_ENCRYPTION_KEY: legacyKey.toString("hex") }), { secretBase32: "JBSWY3DPEHPK3PXP" });
  await assert.rejects(decryptSecret(legacy, { NODE_ENV: "test" }), (error) => error.code === "PLATFORM_SECRETS_NOT_CONFIGURED" && /secrets:migrate-legacy/.test(error.message));
});
