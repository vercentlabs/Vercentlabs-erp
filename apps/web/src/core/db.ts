import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseConfig } from "@vercentlabs/config";

import { resolveDbSsl } from "./db-ssl.ts";
import { runTenantTransaction } from "@vercentlabs/database";

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
    // Same bounds as the worker: pool size, connect/idle timeouts, and a
    // server-side statement timeout so one slow query cannot pin a connection.
    const config = databaseConfig(process.env, { defaultPoolMaximum: 10 });
    pool = new Pool({
      connectionString: config.connectionString,
      max: config.poolMaximum,
      idleTimeoutMillis: config.idleTimeoutMilliseconds,
      connectionTimeoutMillis: config.connectionTimeoutMilliseconds,
      query_timeout: config.queryTimeoutMilliseconds,
      statement_timeout: config.statementTimeoutMilliseconds,
      application_name: "vercentlabs-web",
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
// through a request must use this (or workspaceTransaction below), not the
// bare `transaction()` above, so Postgres RLS policies keyed on
// app.current_organization_id apply. The BEGIN/context/COMMIT/ROLLBACK
// sequence is @vercentlabs/database's runTenantTransaction — the same one the
// worker uses.
export async function tenantTransaction<T>(
  organizationId: string,
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await runTenantTransaction(client, organizationId, handler);
  } finally {
    client.release();
  }
}

// Preferred form for new code: the tenant comes from the authenticated
// principal/session object itself, so a caller cannot pass a
// browser-supplied organizationId by mistake.
export async function workspaceTransaction<T>(
  principal: { readonly organizationId: string },
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return tenantTransaction(principal.organizationId, handler);
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

// A pg-compatible queryable over the pool for platform checks (readiness):
// one statement per call, no transaction, no tenant context.
export const runtimeQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => getPool().query<T>(text, values),
};
