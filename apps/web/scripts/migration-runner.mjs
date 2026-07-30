import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const NON_TRANSACTIONAL_MARKER = "-- vercentlabs:migration nontransactional";

export function migrationChecksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

export function prepareTransactionalSql(sql) {
  const trimmed = sql.trim();
  const withoutBegin = trimmed.replace(/^BEGIN\s*;\s*/i, "");
  return withoutBegin.replace(/\s*COMMIT\s*;\s*$/i, "");
}

export async function runMigrations({
  pool,
  directory,
  tableName,
  lockName,
  label,
}) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
    throw new Error("Invalid migration table name.");
  }

  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        state text NOT NULL DEFAULT 'applied',
        started_at timestamptz,
        applied_at timestamptz,
        failed_at timestamptz,
        error_message text,
        CHECK (state IN ('applying','applied','failed'))
      )
    `);
    await client.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'applied'`);
    await client.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS started_at timestamptz`);
    await client.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS failed_at timestamptz`);
    await client.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS error_message text`);
    await client.query(`ALTER TABLE ${tableName} ALTER COLUMN applied_at DROP NOT NULL`);
    await client.query(`UPDATE ${tableName} SET state='applied', applied_at=COALESCE(applied_at,now()) WHERE state IS NULL OR state='applied'`);
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      lockName,
    ]);

    for (const name of files) {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      const checksum = migrationChecksum(sql);
      const existing = await client.query(
        `SELECT checksum,state,started_at,error_message FROM ${tableName} WHERE name = $1`,
        [name],
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(
            `${label} migration ${name} changed after it was registered.`,
          );
        }
        if (existing.rows[0].state !== "applied") {
          throw new Error(
            `${label} migration ${name} is recorded as ${existing.rows[0].state}. ` +
              "A nontransactional migration may have stopped after changing the database. " +
              "Inspect and reconcile it before explicitly marking it applied; it will not be rerun automatically.",
          );
        }
        console.log(`Skipped ${name}`);
        continue;
      }

      const nonTransactional = sql.includes(NON_TRANSACTIONAL_MARKER);
      if (nonTransactional) {
        await client.query(
          `INSERT INTO ${tableName} (name,checksum,state,started_at,applied_at)
           VALUES ($1,$2,'applying',now(),NULL)`,
          [name, checksum],
        );
        try {
          await client.query(sql);
          await client.query(
            `UPDATE ${tableName}
                SET state='applied',applied_at=now(),failed_at=NULL,error_message=NULL
              WHERE name=$1 AND checksum=$2 AND state='applying'`,
            [name, checksum],
          );
        } catch (error) {
          await client.query(
            `UPDATE ${tableName}
                SET state='failed',failed_at=now(),error_message=$2
              WHERE name=$1 AND checksum=$3 AND state='applying'`,
            [
              name,
              error instanceof Error ? error.message.slice(0, 2000) : "unknown_error",
              checksum,
            ],
          ).catch(() => undefined);
          throw error;
        }
      } else {
        await client.query("BEGIN");
        try {
          await client.query(prepareTransactionalSql(sql));
          await client.query(
            `INSERT INTO ${tableName} (name,checksum,state,started_at,applied_at)
             VALUES ($1,$2,'applied',now(),now())`,
            [name, checksum],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      console.log(`Applied ${name}`);
    }

    console.log(`${label} migrations completed.`);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName])
      .catch(() => undefined);
    client.release();
  }
}
