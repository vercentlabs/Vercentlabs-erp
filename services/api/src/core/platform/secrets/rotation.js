// Every column that stores an encrypted secret. `verify:production` fails if a
// migration adds an encrypted column that is not registered here, so the
// re-encryption commands can never silently skip data.
import { audit } from "../../security/request-security.js";
import { decryptSecret, encryptSecret, isEnvelope, isLegacyPayload, resolveSecretsProvider } from "./envelope.js";

export const ENCRYPTED_COLUMNS = Object.freeze([
  Object.freeze({ table: "public.users", column: "mfa_secret_encrypted", purpose: "MFA TOTP seed" }),
  Object.freeze({ table: "public.users", column: "mfa_pending_secret_encrypted", purpose: "MFA enrolment seed" }),
  Object.freeze({ table: "public.oauth_states", column: "encrypted_code_verifier", purpose: "OAuth PKCE verifier" }),
  Object.freeze({ table: "public.oauth_connections", column: "encrypted_credentials", purpose: "OAuth tokens" }),
  Object.freeze({ table: "public.inbound_mail_routes", column: "encrypted_signing_secret", purpose: "Inbound email signing secret" }),
  Object.freeze({ table: "tenant.webhook_subscriptions", column: "encrypted_signing_secret", purpose: "Webhook signing secret" }),
]);

const IDENT = /^[a-z_]+\.[a-z_]+$|^[a-z_]+$/;
const assertRegistered = (entry) => {
  if (!IDENT.test(entry.table) || !IDENT.test(entry.column)) throw new Error("Invalid encrypted column registration.");
  return entry;
};

/** Counts stored secrets per key reference ("legacy" = old environment key). */
export async function secretInventory(queryable) {
  const inventory = [];
  for (const entry of ENCRYPTED_COLUMNS.map(assertRegistered)) {
    const { rows } = await queryable.query(
      `SELECT CASE WHEN ${entry.column} ? 'v' THEN ${entry.column}->>'kek' ELSE 'legacy' END AS key_reference, count(*)::int AS count
         FROM ${entry.table} WHERE ${entry.column} IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    for (const row of rows) inventory.push({ table: entry.table, column: entry.column, keyReference: row.key_reference, count: row.count });
  }
  return inventory;
}

/**
 * Rewrites secrets into fresh envelopes on the CURRENT key.
 *   mode "legacy"  only rows still on INTEGRATION_TOKEN_ENCRYPTION_KEY
 *   mode "rotate"  rows on any key version other than the current primary
 * Resumable (keyset by primary key), idempotent (a rewritten row no longer
 * matches), bounded (batchSize x maxBatches per column), dry-run capable, and
 * audited once per run. The row is only updated if it still holds exactly
 * the payload that was read (optimistic check), so a concurrent write wins.
 */
export async function reencryptSecrets(withTransaction, { mode = "rotate", dryRun = false, batchSize = 100, maxBatches = 50, env = process.env } = {}) {
  if (!["legacy", "rotate"].includes(mode)) throw new Error("mode must be legacy or rotate.");
  const provider = resolveSecretsProvider(env);
  const current = await provider.currentKeyReference();
  const size = Math.min(Math.max(Number(batchSize) || 100, 1), 1000);
  const summary = { mode, dryRun, currentKey: current, columns: [] };
  for (const entry of ENCRYPTED_COLUMNS.map(assertRegistered)) {
    const needs = (payload) => (mode === "legacy" ? isLegacyPayload(payload) : isLegacyPayload(payload) || (isEnvelope(payload) && payload.kek !== current));
    const result = { table: entry.table, column: entry.column, rewritten: 0, wouldRewrite: 0, failed: 0 };
    let cursor = "";
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await withTransaction(async (client) => {
        const { rows: candidates } = await client.query(
          `SELECT ${entry.column} AS payload, id::text AS id
             FROM ${entry.table}
            WHERE ${entry.column} IS NOT NULL AND id::text > $2
              AND (${mode === "legacy" ? `NOT (${entry.column} ? 'v')` : `NOT (${entry.column} ? 'v') OR ${entry.column}->>'kek' IS DISTINCT FROM $3`})
            ORDER BY id::text LIMIT $1 FOR UPDATE SKIP LOCKED`,
          mode === "legacy" ? [size, cursor] : [size, cursor, current],
        );
        const processed = [];
        for (const row of candidates) {
          if (!needs(row.payload)) {
            processed.push({ id: row.id, outcome: "skip" });
            continue;
          }
          if (dryRun) {
            processed.push({ id: row.id, outcome: "would" });
            continue;
          }
          try {
            const fresh = await encryptSecret(await decryptSecret(row.payload, env), env);
            const updated = await client.query(`UPDATE ${entry.table} SET ${entry.column}=$2::jsonb WHERE id::text=$1 AND ${entry.column}=$3::jsonb`, [row.id, JSON.stringify(fresh), JSON.stringify(row.payload)]);
            processed.push({ id: row.id, outcome: updated.rowCount ? "rewritten" : "skip" });
          } catch {
            processed.push({ id: row.id, outcome: "failed" });
          }
        }
        return processed;
      });
      if (!rows.length) break;
      cursor = rows.at(-1).id;
      for (const row of rows) {
        if (row.outcome === "rewritten") result.rewritten += 1;
        else if (row.outcome === "would") result.wouldRewrite += 1;
        else if (row.outcome === "failed") result.failed += 1;
      }
    }
    summary.columns.push(result);
  }
  if (!dryRun) {
    await withTransaction((client) =>
      audit(client, {
        organizationId: null,
        actorUserId: null,
        eventType: mode === "legacy" ? "secrets.legacy_migrated" : "secrets.reencrypted",
        entityType: "platform_secrets",
        entityId: null,
        metadata: { currentKey: current, columns: summary.columns },
      }),
    );
  }
  return summary;
}
