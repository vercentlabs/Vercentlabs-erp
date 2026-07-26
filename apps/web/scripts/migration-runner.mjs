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
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      lockName,
    ]);

    for (const name of files) {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      const checksum = migrationChecksum(sql);
      const existing = await client.query(
        `SELECT checksum FROM ${tableName} WHERE name = $1`,
        [name],
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(
            `${label} migration ${name} changed after it was applied.`,
          );
        }
        console.log(`Skipped ${name}`);
        continue;
      }

      const nonTransactional = sql.includes(NON_TRANSACTIONAL_MARKER);
      if (nonTransactional) {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${tableName} (name, checksum) VALUES ($1, $2)`,
          [name, checksum],
        );
      } else {
        await client.query("BEGIN");
        try {
          await client.query(prepareTransactionalSql(sql));
          await client.query(
            `INSERT INTO ${tableName} (name, checksum) VALUES ($1, $2)`,
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
