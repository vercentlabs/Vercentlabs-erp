import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { resolveDbSsl } from "./db-ssl.ts";
import { setTenantContext } from "@vercentlabs/database";

// The one connection pool for the ERP web server process (Next.js Route
// Handlers / Server Components — never imported by a Client Component,
// enforced by the `server-only` sentinel above). Business/security LOGIC
// lives in @vercentlabs/api as framework-agnostic, client-injected
// functions (see docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv); this
// module only owns the actual database connection those functions are
// handed.
let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured.");
    }
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || "10"),
      ssl: resolveDbSsl(process.env),
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Row-level-security-scoped variant — every handler touching tenant data
// through a request must use this, not the bare `transaction()` above, so
// Postgres RLS policies keyed on app.current_organization_id apply.
export async function tenantTransaction<T>(
  organizationId: string,
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(async (client) => {
    await setTenantContext(client, organizationId);
    return handler(client);
  });
}

export async function withClient<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}
