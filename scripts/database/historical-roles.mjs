// Role names referenced by IMMUTABLE (shipped, checksummed) migrations.
//
// Tenant migrations 038 and 054 end with `GRANT ... ON ALL TABLES IN SCHEMA
// tenant TO vercent_app` — the single runtime role of that era. On a fresh
// PostgreSQL cluster that role does not exist yet (runtime roles are
// provisioned AFTER migrations), so those files would abort. They cannot be
// edited (a changed checksum aborts every existing database), so:
//
//   1. migrate.mjs, before applying a pending migration that names one of
//      these roles, creates it if absent as a powerless compatibility role
//      (NOLOGIN NOINHERIT, no attributes, no memberships) and marks it with a
//      role comment;
//   2. provision-runtime-role.mjs clears the mark when the role is a
//      configured runtime role (then it is hardened and granted exactly the
//      canonical privileges like any runtime role) and otherwise revokes
//      everything the historical migrations granted it and drops it.
//
// Only roles carrying the mark are ever dropped: a role an operator or a
// developer created is never removed or altered here.
export const HISTORICAL_GRANT_ROLES = Object.freeze(["vercent_app"]);
export const COMPATIBILITY_MARK = "vercentlabs:historical-grant-compatibility";

const ident = (value) => `"${String(value).replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function referencedHistoricalRoles(sqlTexts) {
  return HISTORICAL_GRANT_ROLES.filter((role) => sqlTexts.some((sql) => new RegExp(`\\b${role}\\b`).test(sql)));
}

export async function bootstrapHistoricalRoles(client, sqlTexts, log = console.log) {
  for (const role of referencedHistoricalRoles(sqlTexts)) {
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (exists.rowCount) continue;
    await client.query(`CREATE ROLE ${ident(role)} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await client.query(`COMMENT ON ROLE ${ident(role)} IS ${literal(COMPATIBILITY_MARK)}`);
    log(`BOOTSTRAP historical grant role ${role} (NOLOGIN compatibility role; removed by db:provision:runtime-role unless configured)`);
  }
}

async function markedRoles(client) {
  const { rows } = await client.query(
    `SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) AND shobj_description(oid, 'pg_authid') = $2`,
    [HISTORICAL_GRANT_ROLES, COMPATIBILITY_MARK],
  );
  return rows.map((row) => row.rolname);
}

// Runs inside the provisioning transaction, before the runtime roles are
// provisioned: a configured runtime role keeps its name and simply loses the
// mark (provisioning then hardens it and re-derives its privileges).
export async function adoptConfiguredHistoricalRoles(client, configuredNames) {
  for (const role of await markedRoles(client)) {
    if (configuredNames.includes(role)) await client.query(`COMMENT ON ROLE ${ident(role)} IS NULL`);
  }
}

// After provisioning: every still-marked role is a leftover compatibility
// role. It must own nothing; the privileges historical migrations granted it
// in this database are revoked and the role dropped. If it still holds privileges in another database of the
// cluster, DROP ROLE fails: the role is then kept NOLOGIN and reported.
export async function removeCompatibilityRoles(client, log = console.log) {
  for (const role of await markedRoles(client)) {
    const owned = await client.query(
      `SELECT count(*)::int AS count FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid
        WHERE r.rolname=$1 AND d.deptype='o' AND d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname=current_database()))`,
      [role],
    );
    if (owned.rows[0].count > 0) throw new Error(`Compatibility role ${role} owns database objects; refusing to drop it.`);
    // Explicit revokes by the grantor (the migration role). DROP OWNED would
    // need the role's own privileges, which a PostgreSQL 16 CREATEROLE
    // migrator (Cloud SQL) does not have over roles it created.
    const name = ident(role);
    for (const schema of ["public", "tenant"]) {
      if (!(await client.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount) continue;
      for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
        await client.query(`REVOKE ALL ON ALL ${kind} IN SCHEMA ${schema} FROM ${name}`);
        await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON ${kind} FROM ${name}`);
      }
      await client.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${name}`);
    }
    const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
    await client.query(`REVOKE ALL ON DATABASE ${ident(database)} FROM ${name}`);
    await client.query("SAVEPOINT drop_compatibility_role");
    try {
      await client.query(`DROP ROLE ${ident(role)}`);
      await client.query("RELEASE SAVEPOINT drop_compatibility_role");
      log(`Removed historical compatibility role ${role}.`);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT drop_compatibility_role");
      await client.query(`ALTER ROLE ${ident(role)} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
      log(`Historical compatibility role ${role} kept NOLOGIN (still referenced by another database: ${error.message}).`);
    }
  }
}
