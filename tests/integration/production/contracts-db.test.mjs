// Contract (destructive) migrations refuse to run while data still depends on
// what they drop. Each check executes the real contract file inside a
// transaction that is always rolled back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EXPECTED_MIGRATIONS } from "../../../packages/database/src/index.js";
import { createProductionKit } from "./production-kit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const body = (scope, file) =>
  fs
    .readFileSync(path.join(root, "database", scope, "contracts", file), "utf8")
    .trim()
    .replace(/^BEGIN;\s*/i, "")
    .replace(/\s*COMMIT;\s*$/i, "");

async function inRolledBackTransaction(client, work) {
  await client.query("BEGIN");
  try {
    return await work();
  } finally {
    await client.query("ROLLBACK");
  }
}

test("every contract migration carries a precondition and is never an expand migration", () => {
  for (const scope of ["platform", "tenant"]) {
    for (const file of EXPECTED_MIGRATIONS.contracts[scope]) {
      assert.match(body(scope, file), /RAISE EXCEPTION/i, `${scope}/contracts/${file} has a precondition`);
      assert.ok(!EXPECTED_MIGRATIONS[scope].includes(file), `${file} is not also an expand migration`);
    }
  }
});

test("the attachment-bytes contract refuses while any legacy row remains", async () => {
  const kit = await createProductionKit();
  try {
    const org = await kit.organization("A");
    await inRolledBackTransaction(kit.owner, async () => {
      await kit.owner.query(
        `INSERT INTO public.attachments (organization_id, entity_type, entity_id, file_name, storage_key, content, lifecycle_status, scan_status, logical_id, storage_mode)
         VALUES ($1,'crm.lead',$2,'old.txt','legacy/x',$3,'clean','clean',gen_random_uuid(),'database_legacy')`,
        [org.organizationId, randomUUID(), Buffer.from("bytes")],
      );
      await assert.rejects(kit.owner.query(body("platform", "003_drop_attachment_legacy_bytes.sql")), /still stored in PostgreSQL/);
    });
  } finally {
    await kit.close();
  }
});

test("the retired-tables contract refuses while a numbering series has no policy", async () => {
  const kit = await createProductionKit();
  try {
    const org = await kit.organization("A");
    await inRolledBackTransaction(kit.owner, async () => {
      await kit.owner.query(`INSERT INTO public.numbering_series (organization_id, entity_type, prefix) VALUES ($1, 'never_migrated_type', 'NM-')`, [org.organizationId]);
      await assert.rejects(kit.owner.query(body("platform", "002_drop_retired_platform_tables.sql")), /have no numbering policy/);
    });
  } finally {
    await kit.close();
  }
});

test("the invitation contract backfills first and refuses only what it cannot preserve", async () => {
  const kit = await createProductionKit();
  try {
    const org = await kit.organization("A");
    await inRolledBackTransaction(kit.owner, async () => {
      const roleId = randomUUID();
      await kit.owner.query(`INSERT INTO roles (id, organization_id, name, slug) VALUES ($1, $2, 'Legacy role', $3)`, [roleId, org.organizationId, `legacy-${roleId.slice(0, 8)}`]);
      const invitationId = randomUUID();
      await kit.owner.query(
        `INSERT INTO organization_invitations (id, organization_id, email, role, role_id, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, 'member', $4, $5, $6, now() + interval '1 day')`,
        [invitationId, org.organizationId, `legacy-${invitationId}@test.invalid`, roleId, randomUUID().replaceAll("-", ""), org.ownerId],
      );
      await kit.owner.query(body("platform", "001_drop_legacy_invitation_columns.sql"));
      const normalized = await kit.owner.query(`SELECT role_id, is_primary FROM organization_invitation_roles WHERE invitation_id=$1`, [invitationId]);
      assert.deepEqual(normalized.rows, [{ role_id: roleId, is_primary: true }], "the legacy role was carried into the normalized table before the drop");
    });
  } finally {
    await kit.close();
  }
});
