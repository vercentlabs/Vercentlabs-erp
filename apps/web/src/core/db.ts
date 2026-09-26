import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseConfig } from "@vercentlabs/config";
import { createLogger, monitorPool } from "@vercentlabs/observability";

import { resolveDbSsl } from "./db-ssl.ts";
import { runTenantTransaction, runWithOrganizationConnection, setTenantContext, setUserContext } from "@vercentlabs/database";

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
    monitorPool(pool, createLogger("web-db"), { name: "web", maximum: config.poolMaximum });
  }
  return pool;
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

// One connection under the organisation's context WITHOUT a request-wide
// transaction: the handler opens its own short transactions (billing sagas,
// which must commit before calling the payment provider). The context is reset
// before the connection is released.
export async function organizationConnection<T>(organizationId: string, handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await runWithOrganizationConnection(client, organizationId, handler);
  } finally {
    client.release();
  }
}

// Authenticated self-service outside a full workspace (MFA, sessions,
// profile, onboarding): the verified user's identity context, plus the
// session's organisation context when it has one. Both come from the
// resolved session, never from the request.
export async function sessionTransaction<T>(
  session: { readonly userId: string; readonly organizationId: string | null },
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    try {
      await setUserContext(client, session.userId);
      if (session.organizationId) await setTenantContext(client, session.organizationId);
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

// A user whose credentials were JUST verified (login), before a session
// exists: identity context only.
export async function identityTransaction<T>(userId: string, handler: (client: PoolClient) => Promise<T>): Promise<T> {
  return sessionTransaction({ userId, organizationId: null }, handler);
}

// Pre-authentication ingress with NO organisation or user context: sign-in
// and registration steps, public-token and provider lookups that resolve
// their organisation through a narrow database function (migration 068)
// and then switch to tenantTransaction. Organisation-scoped platform and
// tenant tables are invisible here by design.
export async function ingressTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

// One pooled client, no transaction, no context: rate-limit buckets, auth
// identity reads, and session resolution (which opens its own transaction).
export async function withIngressClient<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
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
