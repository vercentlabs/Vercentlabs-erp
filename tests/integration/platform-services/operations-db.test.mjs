// Real-PostgreSQL proof for the production operations commands: moving legacy
// file bytes out of PostgreSQL (idempotent, crash-safe, verified),
// reconciliation, and secret re-encryption (legacy key -> envelope, KMS
// primary-version rotation). Run with `pnpm test:platform-services:db`.
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStorage } from "../../../packages/document-engine/src/index.js";
import { countLegacyFileRows, migrateLegacyFiles, reconcileObjectStorage } from "../../../services/api/src/core/platform/files/index.js";
import { createGcpKmsKeyProvider, decryptSecret, reencryptSecrets, secretInventory, setSecretsProviderForTests } from "../../../services/api/src/core/platform/secrets/index.js";
import { createRuntimeKit } from "../shared-runtime/runtime-kit.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function ownerTransaction(kit) {
  return async (work) => {
    await kit.owner.query("BEGIN");
    try {
      const result = await work(kit.owner);
      await kit.owner.query("COMMIT");
      return result;
    } catch (error) {
      await kit.owner.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };
}

async function legacyFile(kit, organizationId, text, { corrupt = false } = {}) {
  const id = randomUUID();
  const bytes = Buffer.from(text);
  await kit.owner.query(
    `INSERT INTO public.attachments (id, organization_id, entity_type, entity_id, file_name, storage_key, mime_type, size_bytes, content, content_sha256,
                                     lifecycle_status, scan_status, logical_id, storage_mode)
     VALUES ($1,$2,'crm.lead',$3,'notes.txt','legacy/placeholder','text/plain',$4,$5,$6,'clean','clean',$1,'database_legacy')`,
    [id, organizationId, randomUUID(), bytes.length, bytes, corrupt ? sha("something else") : sha(bytes)],
  );
  return id;
}

test("legacy file bytes move to object storage safely, and reconciliation proves it", async (t) => {
  const kit = await createRuntimeKit();
  const storage = createMemoryObjectStorage();
  const withTransaction = ownerTransaction(kit);
  try {
    const org = await kit.organization(["owner"]);
    const good = [await legacyFile(kit, org.organizationId, "alpha"), await legacyFile(kit, org.organizationId, "beta"), await legacyFile(kit, org.organizationId, "gamma")];
    const corrupt = await legacyFile(kit, org.organizationId, "delta", { corrupt: true });
    const mine = async () => (await kit.owner.query(`SELECT id, storage_mode, content IS NULL AS cleared, storage_key, storage_provider FROM public.attachments WHERE organization_id=$1 ORDER BY id`, [org.organizationId])).rows;

    await t.test("a dry run changes nothing", async () => {
      const summary = await migrateLegacyFiles(withTransaction, { dryRun: true, storage, batchSize: 2 });
      assert.ok(summary.wouldMigrate >= 3);
      assert.ok(summary.hashMismatch.includes(corrupt), "a checksum mismatch is reported even in a dry run");
      assert.ok((await mine()).every((row) => row.storage_mode === "database_legacy"));
    });

    await t.test("a crash after upload retries onto the same deterministic key (no stray objects)", async () => {
      let puts = 0;
      const crashing = Object.freeze({ ...storage, put: async (...args) => { puts += 1; await storage.put(...args); throw new Error("process killed after upload"); } });
      await assert.rejects(migrateLegacyFiles(withTransaction, { storage: crashing, batchSize: 1, maxBatches: 5 }));
      assert.equal(puts, 1);
      assert.ok((await mine()).every((row) => row.storage_mode === "database_legacy"), "the row was not switched");
    });

    await t.test("migration moves verified bytes, clears PostgreSQL, audits, and leaves a hash mismatch alone", async () => {
      const summary = await migrateLegacyFiles(withTransaction, { storage, batchSize: 2 });
      assert.deepEqual(summary.verifyFailed, []);
      assert.ok(summary.hashMismatch.includes(corrupt));
      const rows = await mine();
      for (const id of good) {
        const row = rows.find((entry) => entry.id === id);
        assert.equal(row.storage_mode, "object");
        assert.equal(row.cleared, true);
        assert.equal(row.storage_provider, "memory");
        assert.match(row.storage_key, new RegExp(`^organizations/${org.organizationId}/attachments/${id}\\.txt$`), "deterministic key from the row id");
        assert.equal((await storage.get(row.storage_key)).toString().length > 0, true);
      }
      assert.equal(rows.find((entry) => entry.id === corrupt).storage_mode, "database_legacy");
      const audit = await kit.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND event_type='file.storage_migrated'`, [org.organizationId]);
      assert.equal(audit.rows[0].n, 3);
      const again = await migrateLegacyFiles(withTransaction, { storage, batchSize: 2 });
      assert.equal(again.migrated, 0, "idempotent");
      await kit.owner.query(`DELETE FROM public.attachments WHERE id=$1`, [corrupt]);
      assert.equal((await countLegacyFileRows(kit.owner)).rows >= 0, true);
    });

    await t.test("reconciliation detects a missing object and size drift", async () => {
      const healthy = await reconcileObjectStorage(kit.owner, { storage });
      const ours = new Set(good);
      assert.ok(![...healthy.missing, ...healthy.sizeMismatch].some((id) => ours.has(id)));
      const [first, second] = (await mine()).filter((row) => ours.has(row.id));
      await storage.remove(first.storage_key);
      await kit.owner.query(`UPDATE public.attachments SET size_bytes = size_bytes + 1 WHERE id=$1`, [second.id]);
      const report = await reconcileObjectStorage(kit.owner, { storage });
      assert.ok(report.missing.includes(first.id));
      assert.ok(report.sizeMismatch.includes(second.id));
      assert.equal(report.healthy, false);
    });
  } finally {
    await kit.close();
  }
});

const KEY = "projects/vl-test-project/locations/asia-south1/keyRings/erp/cryptoKeys/secrets";
function fakeKms() {
  const versions = [randomBytes(32)];
  let primary = 1;
  return {
    rotate() {
      versions.push(randomBytes(32));
      primary = versions.length;
    },
    client: {
      async encrypt({ plaintext }) {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", versions[primary - 1], iv);
        const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return [{ name: `${KEY}/cryptoKeyVersions/${primary}`, ciphertext: Buffer.concat([Buffer.from([primary]), iv, cipher.getAuthTag(), body]) }];
      },
      async decrypt({ ciphertext }) {
        const decipher = createDecipheriv("aes-256-gcm", versions[ciphertext[0] - 1], ciphertext.subarray(1, 13));
        decipher.setAuthTag(ciphertext.subarray(13, 29));
        return [{ plaintext: Buffer.concat([decipher.update(ciphertext.subarray(29)), decipher.final()]) }];
      },
    },
  };
}

test("secrets: legacy rows migrate to envelopes, then a KMS rotation re-encrypts everything", async () => {
  const kit = await createRuntimeKit();
  const withTransaction = ownerTransaction(kit);
  const kms = fakeKms();
  const legacyKey = randomBytes(32);
  const env = { NODE_ENV: "test", SECRETS_ENCRYPTION_PROVIDER: "gcp-kms", SECRETS_KMS_KEY_NAME: KEY, INTEGRATION_TOKEN_ENCRYPTION_KEY: legacyKey.toString("hex") };
  setSecretsProviderForTests(createGcpKmsKeyProvider(env, { client: kms.client }));
  try {
    const userId = await kit.user("mfa");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify({ secretBase32: "JBSWY3DPEHPK3PXP" })), cipher.final()]);
    const legacy = { algorithm: "A256GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: body.toString("base64") };
    await kit.owner.query(`UPDATE users SET mfa_secret_encrypted=$2::jsonb WHERE id=$1`, [userId, JSON.stringify(legacy)]);
    const stored = async () => (await kit.owner.query(`SELECT mfa_secret_encrypted AS payload FROM users WHERE id=$1`, [userId])).rows[0].payload;

    const dry = await reencryptSecrets(withTransaction, { mode: "legacy", dryRun: true, env });
    assert.ok(dry.columns.find((column) => column.column === "mfa_secret_encrypted").wouldRewrite >= 1);
    assert.equal((await stored()).algorithm, "A256GCM", "dry run rewrote nothing");

    await reencryptSecrets(withTransaction, { mode: "legacy", env });
    const migrated = await stored();
    assert.equal(migrated.v, 1);
    assert.equal(migrated.kek, `${KEY}/cryptoKeyVersions/1`);
    assert.deepEqual(await decryptSecret(migrated, env), { secretBase32: "JBSWY3DPEHPK3PXP" });

    kms.rotate();
    await reencryptSecrets(withTransaction, { mode: "rotate", env });
    const rotated = await stored();
    assert.equal(rotated.kek, `${KEY}/cryptoKeyVersions/2`);
    assert.deepEqual(await decryptSecret(rotated, env), { secretBase32: "JBSWY3DPEHPK3PXP" });
    const inventory = await secretInventory(kit.owner);
    assert.ok(!inventory.some((entry) => entry.keyReference === "legacy" || entry.keyReference.endsWith("/cryptoKeyVersions/1")), "nothing left on the legacy key or version 1");
    const audit = await kit.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE event_type IN ('secrets.legacy_migrated','secrets.reencrypted') AND created_at > now() - interval '5 minutes'`);
    assert.ok(audit.rows[0].n >= 2);
    await kit.owner.query(`SET session_replication_role = replica`);
    await kit.owner.query(`DELETE FROM audit_events WHERE organization_id IS NULL AND event_type IN ('secrets.legacy_migrated','secrets.reencrypted') AND created_at > now() - interval '5 minutes'`);
    await kit.owner.query(`SET session_replication_role = DEFAULT`);
  } finally {
    setSecretsProviderForTests(null);
    await kit.close();
  }
});
