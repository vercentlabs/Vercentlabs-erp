import { setTenantContext } from "@vercentlabs/database";
import { databaseConfig } from "@vercentlabs/config";
import { Pool, PoolClient, QueryResultRow } from "pg";

declare global {
  var __vercentlabsPool: Pool | undefined;
  var __vercentlabsDbRoleVerification: Promise<void> | undefined;
}

function createPool() {
  const config = databaseConfig(process.env);

  return new Pool({
    connectionString: config.connectionString,
    max: config.poolMaximum,
    idleTimeoutMillis: config.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.connectionTimeoutMilliseconds,
    query_timeout: config.queryTimeoutMilliseconds,
    application_name: "vercentlabs-web-runtime",
    statement_timeout: config.statementTimeoutMilliseconds,
    ssl:
      process.env.NODE_ENV === "production" &&
      !config.connectionString.includes("localhost")
        ? { rejectUnauthorized: true }
        : undefined,
  });
}

export function getPool() {
  if (!global.__vercentlabsPool) global.__vercentlabsPool = createPool();
  return global.__vercentlabsPool;
}

async function verifyRuntimeRole() {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ENFORCE_RESTRICTED_DB_ROLE !== "true"
  ) {
    return;
  }

  const result = await getPool().query<{
    role_name: string;
    is_superuser: boolean;
    bypasses_rls: boolean;
    owns_tables: boolean;
  }>(
    `
      SELECT
        current_user AS role_name,
        role.rolsuper AS is_superuser,
        role.rolbypassrls AS bypasses_rls,
        EXISTS (
          SELECT 1
          FROM pg_class AS relation
          JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          WHERE relation.relowner = role.oid
            AND namespace.nspname IN ('public', 'tenant')
            AND relation.relkind IN ('r', 'p')
        ) AS owns_tables
      FROM pg_roles AS role
      WHERE role.rolname = current_user
    `,
  );
  const current = result.rows[0];
  if (
    !current ||
    current.is_superuser ||
    current.bypasses_rls ||
    current.owns_tables
  ) {
    throw new Error(
      "DATABASE_URL must use a restricted NOSUPERUSER, NOBYPASSRLS, non-owner runtime role.",
    );
  }
}

async function ensureRuntimeRole() {
  if (!global.__vercentlabsDbRoleVerification) {
    global.__vercentlabsDbRoleVerification = verifyRuntimeRole().catch((error) => {
      global.__vercentlabsDbRoleVerification = undefined;
      throw error;
    });
  }
  await global.__vercentlabsDbRoleVerification;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  await ensureRuntimeRole();
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await ensureRuntimeRole();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function tenantTransaction<T>(
  organizationId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(async (client) => {
    await setTenantContext(client, organizationId);
    return work(client);
  });
}
